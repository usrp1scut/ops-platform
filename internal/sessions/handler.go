package sessions

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
)

// canSeeAllSessions returns true when the identity is permitted to view
// other users' session audit + recordings. Holds for system:admin and the
// dedicated bastion.session:read permission. Anyone else is restricted to
// their own session rows.
func canSeeAllSessions(identity iam.UserIdentity) bool {
	if iam.IsAdmin(identity) {
		return true
	}
	for _, p := range identity.Permissions {
		if p == "bastion.session:read" {
			return true
		}
	}
	return false
}

// RecordingFetcher resolves a storage object key to a readable stream. Kept
// as a small interface so the sessions package doesn't import storage and
// the test harness can swap in an in-memory backend.
type RecordingFetcher interface {
	GetObject(ctx context.Context, key string) (io.ReadCloser, RecordingObject, error)
}

// RecordingObject is the metadata returned by RecordingFetcher; mirrors the
// shape of internal/storage.Object without importing it.
type RecordingObject struct {
	Key         string
	Size        int64
	ContentType string
}

type Handler struct {
	repo       *Repository
	recordings RecordingFetcher
	readMW     func(http.Handler) http.Handler
}

// NewHandler builds the session HTTP handler. recordings may be nil when the
// platform is started without object storage; the recording route then
// returns 404 instead of trying to fetch.
func NewHandler(repo *Repository, recordings RecordingFetcher, read func(http.Handler) http.Handler) *Handler {
	return &Handler{repo: repo, recordings: recordings, readMW: read}
}

func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.With(h.readMW).Get("/", h.list)
	r.With(h.readMW).Get("/{sessionID}/recording", h.recording)
	return r
}

func (h *Handler) recording(w http.ResponseWriter, r *http.Request) {
	if h.recordings == nil {
		httpx.WriteError(w, http.StatusNotFound, "recording storage not configured")
		return
	}
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	id := chi.URLParam(r, "sessionID")
	// Owner check first — return 404 (not 403) on cross-user access so the
	// existence of someone else's recording isn't disclosed.
	if !canSeeAllSessions(identity) {
		ownerID, err := h.repo.GetSessionOwner(r.Context(), id)
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ownerID == "" || ownerID != identity.User.ID {
			httpx.WriteError(w, http.StatusNotFound, "no recording for session")
			return
		}
	}
	uri, err := h.repo.GetRecordingURI(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if uri == "" {
		httpx.WriteError(w, http.StatusNotFound, "no recording for session")
		return
	}
	body, obj, err := h.recordings.GetObject(r.Context(), uri)
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, "fetch recording: "+err.Error())
		return
	}
	defer body.Close()
	contentType := obj.ContentType
	if contentType == "" {
		contentType = "application/x-asciicast"
	}
	w.Header().Set("Content-Type", contentType)
	if obj.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(obj.Size, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.cast"`)
	if _, err := io.Copy(w, body); err != nil && !errors.Is(err, context.Canceled) {
		// The header is already flushed at this point so we can't switch to
		// an error response — just log via the standard library writer.
		// Caller will see truncated bytes; that's the right signal.
		_ = err
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	q := ListQuery{
		UserID:  r.URL.Query().Get("user_id"),
		AssetID: r.URL.Query().Get("asset_id"),
	}
	// Non-admin / non-session-reader callers can only see their own sessions,
	// regardless of any user_id query parameter. This is the boundary that
	// stops a viewer with cmdb.asset:read from enumerating who-connected-where.
	if !canSeeAllSessions(identity) {
		q.UserID = identity.User.ID
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		q.Offset = v
	}
	items, err := h.repo.List(r.Context(), q)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}
