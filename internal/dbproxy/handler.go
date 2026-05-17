package dbproxy

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"ops-platform/internal/connectivity"
	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
	"ops-platform/internal/sessions"
)

// AssetMetaLookup returns lightweight asset metadata for the session audit
// row. cmdb.Repository implements it (shared with guacproxy/terminal).
type AssetMetaLookup interface {
	GetAssetSessionMeta(ctx context.Context, assetID string) (assetName, proxyID, proxyName string, err error)
}

type Handler struct {
	svc      *Service
	tickets  *connectivity.TicketService
	meta     AssetMetaLookup
	sessions *sessions.Repository
	logger   *log.Logger
	upgrader websocket.Upgrader
}

func NewHandler(svc *Service, tickets *connectivity.TicketService, meta AssetMetaLookup, sess *sessions.Repository) *Handler {
	return &Handler{
		svc:      svc,
		tickets:  tickets,
		meta:     meta,
		sessions: sess,
		logger:   log.New(log.Writer(), "dbproxy ", log.LstdFlags),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  32768,
			WriteBufferSize: 32768,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// IssueTicket issues a short-lived ticket for the authenticated user. The
// route is already gated by RequireSessionAuthorization(...,"connect",...),
// the same chokepoint as the SSH terminal and the guacd protocols.
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

// ServeWS bridges a browser/helper WebSocket to a freshly-opened raw-TCP
// connection to the database. Auth via ?ticket=... since WS connects can't
// carry headers; the ticket is asset-bound and single-use.
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

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	dbc, err := h.svc.Open(ctx, assetID)
	cancel()
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer dbc.Close()

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

	bytesIn, bytesOut, runErr := bridge(conn, dbc)

	if auditID != "" {
		msg := ""
		if runErr != nil && !isClosedErr(runErr) {
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

// bridge pumps bytes both ways between the WebSocket (binary frames — DB
// wire protocols are binary) and the raw TCP connection, counting traffic
// for the audit row. The payload is never inspected.
func bridge(ws *websocket.Conn, db *Conn) (bytesIn, bytesOut int64, err error) {
	errCh := make(chan error, 2)
	var inTotal, outTotal int64

	// client -> db
	go func() {
		for {
			_, data, rerr := ws.ReadMessage()
			if rerr != nil {
				errCh <- rerr
				return
			}
			inTotal += int64(len(data))
			if _, werr := db.Write(data); werr != nil {
				errCh <- werr
				return
			}
		}
	}()

	// db -> client
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := db.Read(buf)
			if n > 0 {
				outTotal += int64(n)
				if werr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					errCh <- werr
					return
				}
			}
			if rerr != nil {
				errCh <- rerr
				return
			}
		}
	}()

	// First side to error ends the session; closing the DB conn unblocks
	// the peer goroutine. Byte totals are best-effort audit metadata
	// (mirrors the guacproxy bridge contract).
	err = <-errCh
	_ = db.Close()
	bytesIn, bytesOut = inTotal, outTotal
	return
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
	if id.User.OIDCSubject != "" {
		return id.User.OIDCSubject
	}
	return id.User.ID
}
