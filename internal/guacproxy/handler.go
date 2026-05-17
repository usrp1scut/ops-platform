package guacproxy

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"ops-platform/internal/connectivity"
	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
	"ops-platform/internal/sessions"
	"ops-platform/internal/storage"
)

// guacRecordingContentType is the stored object content-type for RDP session
// recordings. The "rdp/" key prefix plus this type let the audit/recording
// path tell a Guacamole recording apart from an SSH asciicast without a
// schema migration.
const guacRecordingContentType = "application/vnd.glyptodon.guacamole.recording"

// AssetMetaLookup returns lightweight asset metadata for session audit.
type AssetMetaLookup interface {
	GetAssetSessionMeta(ctx context.Context, assetID string) (assetName, proxyID, proxyName string, err error)
}

// Handler serves RDP ticketing and WebSocket bridging.
type Handler struct {
	svc      *Service
	tickets  *connectivity.TicketService
	meta     AssetMetaLookup
	sessions *sessions.Repository
	storage  *storage.Client // nil-safe: when nil, recordings are skipped
	maxRec   int64           // per-session recording cap; 0 = unlimited
	logger   *log.Logger

	upgrader websocket.Upgrader
}

// NewHandler wires the RDP proxy handler. store may be nil when recording is
// not configured (OPS_RECORDING_ENDPOINT unset); the handler then bridges
// sessions normally without writing a Guacamole recording. maxRecBytes caps
// a single recording (0 = unlimited).
func NewHandler(svc *Service, tickets *connectivity.TicketService, meta AssetMetaLookup, sess *sessions.Repository, store *storage.Client, maxRecBytes int64) *Handler {
	return &Handler{
		svc:      svc,
		tickets:  tickets,
		meta:     meta,
		sessions: sess,
		storage:  store,
		maxRec:   maxRecBytes,
		logger:   log.New(log.Writer(), "guacproxy ", log.LstdFlags),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  8192,
			WriteBufferSize: 8192,
			CheckOrigin:     func(r *http.Request) bool { return true },
			Subprotocols:    []string{"guacamole"},
		},
	}
}

// IssueTicket issues a short-lived ticket for the authenticated user.
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

// ServeWS bridges a browser WebSocket to a freshly-opened guacd session.
// Auth via ?ticket=... since browsers cannot set headers on WS connects.
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	token := r.URL.Query().Get("ticket")
	if token == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "ticket required")
		return
	}
	t, err := h.tickets.ConsumeTicket(token)
	if err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if t.AssetID != assetID {
		httpx.WriteError(w, http.StatusForbidden, "ticket does not match asset")
		return
	}

	params := RDPParams{}
	if v := r.URL.Query().Get("width"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params.Width = n
		}
	}
	if v := r.URL.Query().Get("height"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params.Height = n
		}
	}
	if v := r.URL.Query().Get("dpi"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params.DPI = n
		}
	}
	if v := r.URL.Query().Get("timezone"); v != "" {
		params.Timezone = v
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	session, err := h.svc.OpenRDP(ctx, assetID, params)
	cancel()
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer session.Close()

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var auditID string
	if h.sessions != nil && h.meta != nil {
		assetName, proxyID, proxyName, _ := h.meta.GetAssetSessionMeta(r.Context(), assetID)
		id, sErr := h.sessions.Start(r.Context(), sessions.StartInput{
			UserID:    t.UserID,
			UserName:  t.UserName,
			AssetID:   assetID,
			AssetName: assetName,
			ProxyID:   proxyID,
			ProxyName: proxyName,
			ClientIP:  clientIP(r),
		})
		if sErr == nil {
			auditID = id
		}
	}

	recorder := h.openRecorder(auditID)

	bytesIn, bytesOut, runErr := bridge(conn, session, recorder)
	if runErr != nil && !isClosedErr(runErr) {
		_ = conn.WriteMessage(websocket.TextMessage, errorInstruction(runErr.Error()))
	}

	if auditID != "" {
		msg := ""
		if runErr != nil {
			msg = runErr.Error()
		}
		endCtx, endCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = h.sessions.End(endCtx, sessions.EndInput{
			SessionID: auditID,
			BytesIn:   bytesIn,
			BytesOut:  bytesOut,
			Error:     msg,
		})
		endCancel()
		// Upload runs on its own deadline, after End, so a slow upload of a
		// large graphical recording can't drop the session-end audit row.
		uploadCtx, uploadCancel := context.WithTimeout(context.Background(), 60*time.Second)
		h.finalizeRecording(uploadCtx, auditID, recorder)
		uploadCancel()
		if recorder.Truncated() {
			h.logger.Printf("recording truncated at size cap: session=%s cap=%d bytes", auditID, h.maxRec)
		}
	} else if recorder != nil {
		// No audit row to attach to; drop the temp file rather than orphan it.
		_, _ = recorder.Close()
		_ = os.Remove(recorder.Path())
	}
}

// openRecorder creates a per-session Guacamole recording file when storage is
// configured and the session has an audit row to attach the upload to. A nil
// return is the safe no-op path (recording disabled).
func (h *Handler) openRecorder(sessionID string) *Recorder {
	if sessionID == "" || h.storage == nil || !h.storage.IsEnabled() {
		return nil
	}
	path := filepath.Join(os.TempDir(), "ops-rdp-"+sessionID+".guac")
	rec, err := NewRecorder(path, h.maxRec)
	if err != nil {
		h.logger.Printf("recorder open failed: session=%s err=%v", sessionID, err)
		return nil
	}
	return rec
}

// finalizeRecording closes the recording file, uploads it to object storage,
// and persists the storage key + size on the session row. All errors are
// logged but never bubbled — a failed upload must not break session audit.
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
		h.logger.Printf("open recording failed: session=%s err=%v", sessionID, err)
		return
	}
	defer f.Close()
	key := "rdp/" + time.Now().UTC().Format("2006/01/02") + "/" + sessionID + ".guac"
	obj, err := h.storage.PutObject(ctx, key, f, size, guacRecordingContentType)
	if err != nil {
		h.logger.Printf("upload recording failed: session=%s err=%v", sessionID, err)
		return
	}
	if err := h.sessions.SetRecording(ctx, sessionID, obj.Key, obj.Size); err != nil {
		h.logger.Printf("persist recording metadata failed: session=%s err=%v", sessionID, err)
	}
}

// bridge shuttles Guacamole instructions between the WebSocket and the guacd
// TCP connection. The guacd→WS direction reads one instruction at a time and
// emits it as a single text frame, which keeps every frame valid UTF-8 even
// when the TCP stream is split mid-codepoint. The WS→guacd direction writes
// each incoming frame verbatim (browser tunnels already send complete
// instructions per frame).
func bridge(ws *websocket.Conn, sess *Session, rec *Recorder) (bytesIn, bytesOut int64, err error) {
	errCh := make(chan error, 2)
	var outTotal, inTotal int64

	go func() {
		for {
			ins, rerr := ReadInstruction(sess.Reader())
			if rerr != nil {
				bytesOut = outTotal
				errCh <- rerr
				return
			}
			payload := []byte(ins.Encode())
			outTotal += int64(len(payload))
			// Record what the operator saw BEFORE forwarding, so a slow
			// websocket send can't drop frames from the audit recording.
			// Only this (server→client) direction is recorded; inbound
			// keystrokes/clipboard are never written. nil rec is a no-op;
			// a write error degrades the recording but must not kill the
			// live session, so it is intentionally not propagated.
			_ = rec.Write(payload)
			if werr := ws.WriteMessage(websocket.TextMessage, payload); werr != nil {
				bytesOut = outTotal
				errCh <- werr
				return
			}
		}
	}()

	go func() {
		for {
			_, data, rerr := ws.ReadMessage()
			if rerr != nil {
				bytesIn = inTotal
				errCh <- rerr
				return
			}
			inTotal += int64(len(data))
			if _, werr := sess.Write(data); werr != nil {
				bytesIn = inTotal
				errCh <- werr
				return
			}
		}
	}()

	err = <-errCh
	// Drain second goroutine's counter before returning.
	select {
	case <-errCh:
	default:
	}
	if bytesIn == 0 {
		bytesIn = inTotal
	}
	if bytesOut == 0 {
		bytesOut = outTotal
	}
	return bytesIn, bytesOut, err
}

func errorInstruction(msg string) []byte {
	ins := Instruction{Opcode: "error", Args: []string{msg, "1000"}}
	return []byte(ins.Encode())
}

func isClosedErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) {
		return true
	}
	if _, ok := err.(*websocket.CloseError); ok {
		return true
	}
	return false
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return v
	}
	return r.RemoteAddr
}

func displayName(id iam.UserIdentity) string {
	if id.User.Name != "" {
		return id.User.Name
	}
	if id.User.Email != "" {
		return id.User.Email
	}
	return id.User.ID
}

