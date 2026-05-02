package iam

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/config"
	"ops-platform/internal/platform/httpx"
)

type AdminHandler struct {
	cfg     config.Config
	repo    *Repository
	readMW  func(http.Handler) http.Handler
	writeMW func(http.Handler) http.Handler
}

func NewAdminHandler(
	cfg config.Config,
	repo *Repository,
	readMW func(http.Handler) http.Handler,
	writeMW func(http.Handler) http.Handler,
) *AdminHandler {
	return &AdminHandler{
		cfg:     cfg,
		repo:    repo,
		readMW:  readMW,
		writeMW: writeMW,
	}
}

func (h *AdminHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.With(h.withReadAuth).Get("/users", h.ListUsers)
	r.With(h.withReadAuth).Get("/users/{userID}", h.GetUserIdentity)
	r.With(h.withReadAuth).Get("/roles", h.ListRoles)
	r.With(h.withReadAuth).Get("/roles/{roleName}/permissions", h.GetRolePermissions)
	r.With(h.withReadAuth).Get("/oidc-config", h.GetOIDCSettings)
	r.With(h.withWriteAuth).Put("/oidc-config", h.UpdateOIDCSettings)
	r.With(h.withWriteAuth).Post("/users/{userID}/roles", h.BindRole)
	r.With(h.withWriteAuth).Delete("/users/{userID}/roles/{roleName}", h.UnbindRole)

	return r
}

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.repo.ListUsers(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": users})
}

func (h *AdminHandler) GetUserIdentity(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	identity, err := h.repo.IdentityForUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, identity)
}

func (h *AdminHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	includePermissions := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("include_permissions")), "true") ||
		strings.TrimSpace(r.URL.Query().Get("include_permissions")) == "1"
	if includePermissions {
		roles, err := h.repo.ListRolesWithPermissions(r.Context())
		if err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": roles})
		return
	}

	roles, err := h.repo.ListRoles(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": roles})
}

func (h *AdminHandler) GetRolePermissions(w http.ResponseWriter, r *http.Request) {
	roleName := strings.TrimSpace(chi.URLParam(r, "roleName"))
	if roleName == "" {
		httpx.WriteError(w, http.StatusBadRequest, "roleName is required")
		return
	}

	permissions, err := h.repo.ListRolePermissions(r.Context(), roleName)
	if err != nil {
		if errors.Is(err, ErrRoleNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"role_name":   roleName,
		"permissions": permissions,
	})
}

func (h *AdminHandler) BindRole(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	var req BindRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	req.RoleName = strings.TrimSpace(req.RoleName)
	if req.RoleName == "" {
		httpx.WriteError(w, http.StatusBadRequest, "role_name is required")
		return
	}

	if err := h.repo.BindRoleToUser(r.Context(), userID, req.RoleName); err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound), errors.Is(err, ErrRoleNotFound):
			httpx.WriteError(w, http.StatusNotFound, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	identity, err := h.repo.IdentityForUser(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, identity)
}

func (h *AdminHandler) UnbindRole(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	roleName := strings.TrimSpace(chi.URLParam(r, "roleName"))
	if roleName == "" {
		httpx.WriteError(w, http.StatusBadRequest, "roleName is required")
		return
	}

	if err := h.repo.UnbindRoleFromUser(r.Context(), userID, roleName); err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound), errors.Is(err, ErrRoleNotFound), errors.Is(err, ErrUserRoleBindingNotFound):
			httpx.WriteError(w, http.StatusNotFound, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	identity, err := h.repo.IdentityForUser(r.Context(), userID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, identity)
}

func (h *AdminHandler) GetOIDCSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.repo.GetOIDCSettings(r.Context(), h.cfg.MasterKey)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if !settings.Exists {
		settings = OIDCSettings{
			Enabled:         h.cfg.OIDCClientID != "" && h.cfg.OIDCRedirectURL != "",
			IssuerURL:       h.cfg.OIDCIssuerURL,
			ClientID:        h.cfg.OIDCClientID,
			HasClientSecret: strings.TrimSpace(h.cfg.OIDCClientSecret) != "",
			RedirectURL:     h.cfg.OIDCRedirectURL,
			AuthorizeURL:    h.cfg.OIDCAuthorizeURL,
			TokenURL:        h.cfg.OIDCTokenURL,
			UserInfoURL:     h.cfg.OIDCUserInfoURL,
			Scopes:          normalizeScopes(h.cfg.OIDCScopes),
		}
	}

	httpx.WriteJSON(w, http.StatusOK, settings)
}

func (h *AdminHandler) UpdateOIDCSettings(w http.ResponseWriter, r *http.Request) {
	var req UpdateOIDCSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	req.IssuerURL = strings.TrimSpace(req.IssuerURL)
	req.ClientID = strings.TrimSpace(req.ClientID)
	req.RedirectURL = strings.TrimSpace(req.RedirectURL)
	req.AuthorizeURL = strings.TrimSpace(req.AuthorizeURL)
	req.TokenURL = strings.TrimSpace(req.TokenURL)
	req.UserInfoURL = strings.TrimSpace(req.UserInfoURL)
	req.Scopes = normalizeScopes(req.Scopes)

	if req.Enabled {
		if req.ClientID == "" || req.RedirectURL == "" {
			httpx.WriteError(w, http.StatusBadRequest, "client_id and redirect_url are required when enabled")
			return
		}
		if req.AuthorizeURL == "" {
			if req.IssuerURL == "" {
				httpx.WriteError(w, http.StatusBadRequest, "authorize_url or issuer_url is required when enabled")
				return
			}
			req.AuthorizeURL = strings.TrimRight(req.IssuerURL, "/") + "/authorize"
		}
		if req.TokenURL == "" {
			if req.IssuerURL == "" {
				httpx.WriteError(w, http.StatusBadRequest, "token_url or issuer_url is required when enabled")
				return
			}
			req.TokenURL = strings.TrimRight(req.IssuerURL, "/") + "/token"
		}
		if req.UserInfoURL == "" {
			if req.IssuerURL == "" {
				httpx.WriteError(w, http.StatusBadRequest, "userinfo_url or issuer_url is required when enabled")
				return
			}
			req.UserInfoURL = strings.TrimRight(req.IssuerURL, "/") + "/userinfo"
		}
	}

	settings, err := h.repo.SaveOIDCSettings(r.Context(), req, h.cfg.MasterKey)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, settings)
}

func (h *AdminHandler) withReadAuth(next http.Handler) http.Handler {
	if h.readMW == nil {
		return next
	}
	return h.readMW(next)
}

func (h *AdminHandler) withWriteAuth(next http.Handler) http.Handler {
	if h.writeMW == nil {
		return next
	}
	return h.writeMW(next)
}
