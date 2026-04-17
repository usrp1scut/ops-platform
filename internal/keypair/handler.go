package keypair

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
)

type Handler struct {
	repo    *Repository
	readMW  func(http.Handler) http.Handler
	writeMW func(http.Handler) http.Handler
}

func NewHandler(repo *Repository, readMW, writeMW func(http.Handler) http.Handler) *Handler {
	return &Handler{repo: repo, readMW: readMW, writeMW: writeMW}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(h.withRead).Get("/", h.List)
	r.With(h.withWrite).Post("/", h.Upsert)
	r.With(h.withWrite).Delete("/{id}", h.Delete)
	return r
}

func (h *Handler) withRead(next http.Handler) http.Handler {
	if h.readMW == nil {
		return next
	}
	return h.readMW(next)
}

func (h *Handler) withWrite(next http.Handler) http.Handler {
	if h.writeMW == nil {
		return next
	}
	return h.writeMW(next)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	kps, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if kps == nil {
		kps = []Keypair{}
	}
	writeJSON(w, http.StatusOK, kps)
}

func (h *Handler) Upsert(w http.ResponseWriter, r *http.Request) {
	var req UpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	uploadedBy := ""
	if identity, ok := iam.IdentityFromContext(r.Context()); ok {
		uploadedBy = identity.User.Name
		if uploadedBy == "" {
			uploadedBy = identity.User.Email
		}
	}

	kp, err := h.repo.Upsert(r.Context(), req, uploadedBy)
	if err != nil {
		if errors.Is(err, ErrInvalidKey) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, kp)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, ErrKeypairNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
