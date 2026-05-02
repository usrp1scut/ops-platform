package sshproxy

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/platform/httpx"
)

type Handler struct {
	masterKey string
	repo      *Repository
	readMW    func(http.Handler) http.Handler
	writeMW   func(http.Handler) http.Handler
}

func NewHandler(
	masterKey string,
	repo *Repository,
	readMW func(http.Handler) http.Handler,
	writeMW func(http.Handler) http.Handler,
) *Handler {
	return &Handler{masterKey: masterKey, repo: repo, readMW: readMW, writeMW: writeMW}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(h.wrap(h.readMW)).Get("/", h.List)
	r.With(h.wrap(h.writeMW)).Post("/", h.Create)
	r.With(h.wrap(h.readMW)).Get("/{proxyID}", h.Get)
	r.With(h.wrap(h.writeMW)).Patch("/{proxyID}", h.Update)
	r.With(h.wrap(h.writeMW)).Delete("/{proxyID}", h.Delete)
	return r
}

func (h *Handler) wrap(mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	if mw == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return mw
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.repo.List(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, err := h.repo.Get(r.Context(), chi.URLParam(r, "proxyID"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req UpsertSSHProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	p, err := h.repo.Create(r.Context(), req, h.masterKey)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, p)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var req UpsertSSHProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	p, err := h.repo.Update(r.Context(), chi.URLParam(r, "proxyID"), req, h.masterKey)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	err := h.repo.Delete(r.Context(), chi.URLParam(r, "proxyID"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
