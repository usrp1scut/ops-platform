package aws

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
	r.With(h.withReadAuth).Get("/", h.ListAccounts)
	r.With(h.withWriteAuth).Post("/", h.CreateAccount)
	r.With(h.withReadAuth).Get("/{accountID}", h.GetAccount)
	r.With(h.withWriteAuth).Patch("/{accountID}", h.UpdateAccount)
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

func (h *Handler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.repo.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": accounts})
}

func (h *Handler) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var req CreateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	if req.AccountID == "" || req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "account_id and display_name are required")
		return
	}
	if req.AuthMode == "" {
		req.AuthMode = "assume_role"
	}
	if req.AuthMode != "assume_role" && req.AuthMode != "static" {
		writeError(w, http.StatusBadRequest, "auth_mode must be assume_role or static")
		return
	}
	if req.AuthMode == "assume_role" && req.RoleARN == "" {
		writeError(w, http.StatusBadRequest, "role_arn is required for assume_role mode")
		return
	}
	if req.AuthMode == "static" && (req.AccessKeyID == "" || req.SecretAccessKey == "") {
		writeError(w, http.StatusBadRequest, "access_key_id and secret_access_key are required for static mode")
		return
	}

	account, err := h.repo.CreateAccount(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, account)
}

func (h *Handler) GetAccount(w http.ResponseWriter, r *http.Request) {
	account, err := h.repo.GetAccount(r.Context(), chi.URLParam(r, "accountID"))
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (h *Handler) UpdateAccount(w http.ResponseWriter, r *http.Request) {
	var req UpdateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	account, err := h.repo.UpdateAccount(r.Context(), chi.URLParam(r, "accountID"), req)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, account)
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
