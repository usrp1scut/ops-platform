package guacproxy

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"ops-platform/internal/connectivity"
	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
	"ops-platform/internal/sessions"
)

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

	upgrader websocket.Upgrader
}

func NewHandler(svc *Service, tickets *connectivity.TicketService, meta AssetMetaLookup, sess *sessions.Repository) *Handler {
	return &Handler{
		svc:      svc,
		tickets:  tickets,
		meta:     meta,
		sessions: sess,
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

	bytesIn, bytesOut, runErr := bridge(conn, session)
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
	}
}

// bridge shuttles Guacamole instructions between the WebSocket and the guacd
// TCP connection. The guacd→WS direction reads one instruction at a time and
// emits it as a single text frame, which keeps every frame valid UTF-8 even
// when the TCP stream is split mid-codepoint. The WS→guacd direction writes
// each incoming frame verbatim (browser tunnels already send complete
// instructions per frame).
func bridge(ws *websocket.Conn, sess *Session) (bytesIn, bytesOut int64, err error) {
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

