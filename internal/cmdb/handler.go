package cmdb

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	repo    *Repository
	readMW  func(http.Handler) http.Handler
	writeMW func(http.Handler) http.Handler
}

func NewHandler(
	repo *Repository,
	readMW func(http.Handler) http.Handler,
	writeMW func(http.Handler) http.Handler,
) *Handler {
	return &Handler{
		repo:    repo,
		readMW:  readMW,
		writeMW: writeMW,
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.With(h.withReadAuth).Get("/", h.ListAssets)
	r.With(h.withWriteAuth).Post("/", h.CreateAsset)
	r.With(h.withReadAuth).Get("/{assetID}", h.GetAsset)
	r.With(h.withWriteAuth).Patch("/{assetID}", h.UpdateAsset)
	r.With(h.withWriteAuth).Delete("/{assetID}", h.DeleteAsset)

	return r
}

func (h *Handler) withReadAuth(next http.Handler) http.Handler {
	if h.readMW == nil {
		return next
	}
	return h.readMW(next)
}

func (h *Handler) withWriteAuth(next http.Handler) http.Handler {
	if h.writeMW == nil {
		return next
	}
	return h.writeMW(next)
}

func (h *Handler) ListAssets(w http.ResponseWriter, r *http.Request) {
	assets, err := h.repo.ListAssets(
		r.Context(),
		r.URL.Query().Get("type"),
		r.URL.Query().Get("env"),
		r.URL.Query().Get("q"),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": assets})
}

func (h *Handler) CreateAsset(w http.ResponseWriter, r *http.Request) {
	var req CreateAssetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.Type == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "type and name are required")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if req.Env == "" {
		req.Env = "default"
	}
	if req.Source == "" {
		req.Source = "manual"
	}

	asset, err := h.repo.CreateAsset(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (h *Handler) GetAsset(w http.ResponseWriter, r *http.Request) {
	asset, err := h.repo.GetAsset(r.Context(), chi.URLParam(r, "assetID"))
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (h *Handler) UpdateAsset(w http.ResponseWriter, r *http.Request) {
	var req UpdateAssetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	asset, err := h.repo.UpdateAsset(r.Context(), chi.URLParam(r, "assetID"), req)
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (h *Handler) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	err := h.repo.DeleteAsset(r.Context(), chi.URLParam(r, "assetID"))
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody{Error: message})
}
