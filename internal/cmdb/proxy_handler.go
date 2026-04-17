package cmdb

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type ProxyHandler struct {
	masterKey string
	repo      *Repository
	readMW    func(http.Handler) http.Handler
	writeMW   func(http.Handler) http.Handler
}

func NewProxyHandler(
	masterKey string,
	repo *Repository,
	readMW func(http.Handler) http.Handler,
	writeMW func(http.Handler) http.Handler,
) *ProxyHandler {
	return &ProxyHandler{masterKey: masterKey, repo: repo, readMW: readMW, writeMW: writeMW}
}

func (h *ProxyHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(h.wrap(h.readMW)).Get("/", h.List)
	r.With(h.wrap(h.writeMW)).Post("/", h.Create)
	r.With(h.wrap(h.readMW)).Get("/{proxyID}", h.Get)
	r.With(h.wrap(h.writeMW)).Patch("/{proxyID}", h.Update)
	r.With(h.wrap(h.writeMW)).Delete("/{proxyID}", h.Delete)
	return r
}

func (h *ProxyHandler) wrap(mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	if mw == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return mw
}

func (h *ProxyHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.repo.ListSSHProxies(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *ProxyHandler) Get(w http.ResponseWriter, r *http.Request) {
	p, err := h.repo.GetSSHProxy(r.Context(), chi.URLParam(r, "proxyID"))
	if err != nil {
		if errors.Is(err, ErrSSHProxyNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *ProxyHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req UpsertSSHProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	p, err := h.repo.CreateSSHProxy(r.Context(), req, h.masterKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *ProxyHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req UpsertSSHProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	p, err := h.repo.UpdateSSHProxy(r.Context(), chi.URLParam(r, "proxyID"), req, h.masterKey)
	if err != nil {
		if errors.Is(err, ErrSSHProxyNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *ProxyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	err := h.repo.DeleteSSHProxy(r.Context(), chi.URLParam(r, "proxyID"))
	if err != nil {
		if errors.Is(err, ErrSSHProxyNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
