package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"ops-platform/internal/connectivity"
	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
	"ops-platform/internal/sessions"
	"ops-platform/internal/storage"
)

// SSHDialer opens an SSH client to an asset. Implemented by bastionprobe.Service.
type SSHDialer interface {
	DialAssetSSH(ctx context.Context, assetID string) (*ssh.Client, error)
}

// AssetMetaLookup returns lightweight metadata about an asset for session audit.
// Implemented by cmdb.Repository.
type AssetMetaLookup interface {
	GetAssetSessionMeta(ctx context.Context, assetID string) (assetName, proxyID, proxyName string, err error)
}

type Handler struct {
	svc      *Service
	tickets  *connectivity.TicketService
	dialer   SSHDialer
	sessions *sessions.Repository
	meta     AssetMetaLookup
	storage  *storage.Client // nil-safe: when nil, recordings are skipped
	upgrader websocket.Upgrader
	logger   *log.Logger
}

// NewHandler wires the SSH terminal handler. storage may be nil when
// recording is not configured (OPS_RECORDING_ENDPOINT unset); the handler
// then runs sessions normally without writing a cast file.
func NewHandler(svc *Service, tickets *connectivity.TicketService, dialer SSHDialer, sess *sessions.Repository, meta AssetMetaLookup, store *storage.Client) *Handler {
	return &Handler{
		svc:      svc,
		tickets:  tickets,
		dialer:   dialer,
		sessions: sess,
		meta:     meta,
		storage:  store,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
		logger: log.New(log.Writer(), "terminal ", log.LstdFlags),
	}
}

// IssueTicket issues a short-lived ticket for the authenticated user to open a
// WebSocket terminal to the asset. Auth is enforced by the calling router.
func (h *Handler) IssueTicket(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "no identity")
		return
	}
	assetID := chi.URLParam(r, "assetID")
	if assetID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "assetID required")
		return
	}
	token, expires, err := h.tickets.IssueTicket(identity.User.ID, displayName(identity), assetID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ticket":     token,
		"expires_at": expires,
	})
}

// ServeWS upgrades the request to a WebSocket and pipes frames to an SSH PTY.
// Auth is via ?ticket=... since browsers cannot set headers on WS.
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	ticket := r.URL.Query().Get("ticket")
	if ticket == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "ticket required")
		return
	}
	t, err := h.tickets.ConsumeTicket(ticket)
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if t.AssetID != assetID {
		httpx.WriteError(w, http.StatusForbidden, "ticket does not match asset")
		return
	}
	userID, userName := t.UserID, t.UserName

	release, err := h.svc.AcquireSession(userID)
	if err != nil {
		httpx.WriteError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	defer release()

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	assetName, proxyID, proxyName, _ := h.meta.GetAssetSessionMeta(r.Context(), assetID)
	sessionID, sErr := h.sessions.Start(r.Context(), sessions.StartInput{
		UserID:    userID,
		UserName:  userName,
		AssetID:   assetID,
		AssetName: assetName,
		ProxyID:   proxyID,
		ProxyName: proxyName,
		ClientIP:  clientIP(r),
	})
	if sErr != nil {
		h.logger.Printf("session audit start failed: %v", sErr)
	}

	recorder := h.openRecorder(sessionID)

	bytesIn, bytesOut, exitCode, runErr := h.runSession(r.Context(), conn, assetID, userName, recorder)
	if runErr != nil {
		h.logger.Printf("session ended: user=%s asset=%s err=%v", userID, assetID, runErr)
		_ = conn.WriteJSON(map[string]any{"type": "error", "message": runErr.Error()})
	}
	if sessionID != "" {
		endMsg := ""
		if runErr != nil {
			endMsg = runErr.Error()
		}
		endCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.sessions.End(endCtx, sessions.EndInput{
			SessionID: sessionID,
			ExitCode:  exitCode,
			BytesIn:   bytesIn,
			BytesOut:  bytesOut,
			Error:     endMsg,
		})
		// Recording upload runs on its own deadline: a multi-MB cast on a
		// slow link can't fit in the 5s session-end window, and a missed
		// upload silently produces a session row with no recording. The
		// upload happens after End so the audit row is durable either way.
		uploadCtx, uploadCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer uploadCancel()
		h.finalizeRecording(uploadCtx, sessionID, recorder)
	} else if recorder != nil {
		// Session-audit row never landed; close the recorder and drop the
		// temp file rather than uploading an orphaned cast.
		_, _ = recorder.Close()
		_ = os.Remove(recorder.Path())
	}
}

// openRecorder creates a per-session asciinema cast file when storage is
// configured and the session has an audit row to attach the upload to. nil
// return is the safe no-op path; the rest of the handler treats a nil
// recorder as "recording disabled".
func (h *Handler) openRecorder(sessionID string) *Recorder {
	if sessionID == "" || h.storage == nil || !h.storage.IsEnabled() {
		return nil
	}
	path := filepath.Join(os.TempDir(), "ops-cast-"+sessionID+".cast")
	rec, err := NewRecorder(path, 80, 24)
	if err != nil {
		h.logger.Printf("recorder open failed: %v", err)
		return nil
	}
	return rec
}

// finalizeRecording closes the cast file, uploads it to object storage, and
// updates the session row with the storage key + size. All errors are logged
// but never bubbled — a failed upload must not break the session-end audit.
func (h *Handler) finalizeRecording(ctx context.Context, sessionID string, rec *Recorder) {
	if rec == nil {
		return
	}
	path := rec.Path()
	size, err := rec.Close()
	if err != nil {
		h.logger.Printf("recorder close failed: session=%s err=%v", sessionID, err)
	}
	defer os.Remove(path)
	if size == 0 || h.storage == nil || !h.storage.IsEnabled() {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		h.logger.Printf("open cast failed: session=%s err=%v", sessionID, err)
		return
	}
	defer f.Close()
	key := "terminal/" + time.Now().UTC().Format("2006/01/02") + "/" + sessionID + ".cast"
	obj, err := h.storage.PutObject(ctx, key, f, size, "application/x-asciicast")
	if err != nil {
		h.logger.Printf("upload cast failed: session=%s err=%v", sessionID, err)
		return
	}
	if err := h.sessions.SetRecording(ctx, sessionID, obj.Key, obj.Size); err != nil {
		h.logger.Printf("persist recording metadata failed: session=%s err=%v", sessionID, err)
	}
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return v
	}
	return r.RemoteAddr
}

type inboundFrame struct {
	Type    string `json:"type"`
	Payload string `json:"payload,omitempty"`
	Cols    int    `json:"cols,omitempty"`
	Rows    int    `json:"rows,omitempty"`
}

func (h *Handler) runSession(ctx context.Context, ws *websocket.Conn, assetID, userName string, recorder *Recorder) (bytesIn, bytesOut int64, exitCode *int, err error) {
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := h.dialer.DialAssetSSH(dialCtx, assetID)
	if err != nil {
		return 0, 0, nil, err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return 0, 0, nil, err
	}
	defer session.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		return 0, 0, nil, err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		return 0, 0, nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		return 0, 0, nil, err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return 0, 0, nil, err
	}

	if err := session.Shell(); err != nil {
		return 0, 0, nil, err
	}

	idle := h.svc.IdleTimeout()
	sessionCtx, sessionCancel := context.WithCancel(ctx)
	defer sessionCancel()

	var inBytes, outBytes atomicInt64

	// ws -> ssh
	go func() {
		defer sessionCancel()
		ws.SetReadDeadline(time.Now().Add(idle))
		for {
			select {
			case <-sessionCtx.Done():
				return
			default:
			}
			_, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			ws.SetReadDeadline(time.Now().Add(idle))
			var frame inboundFrame
			if jsonErr := json.Unmarshal(data, &frame); jsonErr != nil {
				continue
			}
			switch frame.Type {
			case "data":
				inBytes.add(int64(len(frame.Payload)))
				if _, err := io.WriteString(stdin, frame.Payload); err != nil {
					return
				}
			case "resize":
				if frame.Cols > 0 && frame.Rows > 0 {
					_ = session.WindowChange(frame.Rows, frame.Cols)
				}
			case "ping":
				_ = ws.WriteJSON(map[string]any{"type": "pong"})
			}
		}
	}()

	// ssh -> ws
	pump := func(src io.Reader) {
		defer sessionCancel()
		buf := make([]byte, 4096)
		for {
			n, err := src.Read(buf)
			if n > 0 {
				outBytes.add(int64(n))
				// Record what the user sees BEFORE forwarding to ws so a slow
				// websocket send can't drop frames from the audit cast.
				if rerr := recorder.WriteOutput(buf[:n]); rerr != nil {
					h.logger.Printf("recorder write: %v", rerr)
				}
				if werr := ws.WriteJSON(map[string]any{"type": "data", "payload": string(buf[:n])}); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	go pump(stdout)
	go pump(stderr)

	waitCh := make(chan error, 1)
	go func() { waitCh <- session.Wait() }()

	h.logger.Printf("session started: user=%s asset=%s", userName, assetID)
	select {
	case <-sessionCtx.Done():
		_ = session.Signal(ssh.SIGHUP)
	case werr := <-waitCh:
		var exitErr *ssh.ExitError
		if errors.As(werr, &exitErr) {
			code := exitErr.ExitStatus()
			exitCode = &code
			_ = ws.WriteJSON(map[string]any{"type": "exit", "code": code})
		} else if werr == nil {
			zero := 0
			exitCode = &zero
			_ = ws.WriteJSON(map[string]any{"type": "exit", "code": 0})
		}
	}
	h.logger.Printf("session ended: user=%s asset=%s", userName, assetID)
	return inBytes.get(), outBytes.get(), exitCode, nil
}

type atomicInt64 struct {
	mu sync.Mutex
	v  int64
}

func (a *atomicInt64) add(n int64) { a.mu.Lock(); a.v += n; a.mu.Unlock() }
func (a *atomicInt64) get() int64  { a.mu.Lock(); defer a.mu.Unlock(); return a.v }

func displayName(id iam.UserIdentity) string {
	if id.User.Name != "" {
		return id.User.Name
	}
	if id.User.Email != "" {
		return id.User.Email
	}
	return id.User.ID
}

