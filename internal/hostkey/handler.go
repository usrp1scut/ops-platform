package hostkey

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
)

type Handler struct {
	repo        *Repository
	readMW      func(http.Handler) http.Handler
	writeMW     func(http.Handler) http.Handler
	displayName func(iam.UserIdentity) string
}

func NewHandler(repo *Repository, read, write func(http.Handler) http.Handler) *Handler {
	return &Handler{
		repo:    repo,
		readMW:  read,
		writeMW: write,
		displayName: func(id iam.UserIdentity) string {
			if id.User.Name != "" {
				return id.User.Name
			}
			if id.User.Email != "" {
				return id.User.Email
			}
			return id.User.ID
		},
	}
}

func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.With(h.readMW).Get("/", h.list)
	r.With(h.writeMW).Post("/{scope}/{targetID}/override", h.approveOverride)
	r.With(h.writeMW).Delete("/{scope}/{targetID}", h.delete)
	return r
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.repo.List(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) approveOverride(w http.ResponseWriter, r *http.Request) {
	scope := chi.URLParam(r, "scope")
	targetID := chi.URLParam(r, "targetID")
	if scope != ScopeAsset && scope != ScopeProxy {
		httpx.WriteError(w, http.StatusBadRequest, "scope must be asset|proxy")
		return
	}
	identity, _ := iam.IdentityFromContext(r.Context())
	admin := h.displayName(identity)
	if err := h.repo.ApproveOverride(r.Context(), scope, targetID, admin, OverrideTTL); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "host key record not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"status":     "override_pending",
		"ttl_minute": int(OverrideTTL.Minutes()),
	})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	scope := chi.URLParam(r, "scope")
	targetID := chi.URLParam(r, "targetID")
	if err := h.repo.Delete(r.Context(), scope, targetID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "host key record not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

