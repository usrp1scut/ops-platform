package sessions

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	repo   *Repository
	readMW func(http.Handler) http.Handler
}

func NewHandler(repo *Repository, read func(http.Handler) http.Handler) *Handler {
	return &Handler{repo: repo, readMW: read}
}

func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	r.With(h.readMW).Get("/", h.list)
	return r
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := ListQuery{
		UserID:  r.URL.Query().Get("user_id"),
		AssetID: r.URL.Query().Get("asset_id"),
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		q.Offset = v
	}
	items, err := h.repo.List(r.Context(), q)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
