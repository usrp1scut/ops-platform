package iam

import (
	"encoding/json"
	"errors"
	"io"
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
	r.With(h.withWriteAuth).Post("/oidc-config/test", h.TestOIDCSettings)
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

	httpx.WriteJSON(w, http.StatusOK, settings)
}

func (h *AdminHandler) UpdateOIDCSettings(w http.ResponseWriter, r *http.Request) {
	var req UpdateOIDCSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	req, err := normalizeOIDCSettingsRequest(req)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	settings, err := h.repo.SaveOIDCSettings(r.Context(), req, h.cfg.MasterKey)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeConfigAudit(r, "oidc_config.update", "iam.oidc_config", "1", map[string]any{
		"enabled":       settings.Enabled,
		"issuer_url":    settings.IssuerURL,
		"client_id":     settings.ClientID,
		"redirect_url":  settings.RedirectURL,
		"authorize_url": settings.AuthorizeURL,
		"token_url":     settings.TokenURL,
		"userinfo_url":  settings.UserInfoURL,
		"scopes":        settings.Scopes,
	})

	httpx.WriteJSON(w, http.StatusOK, settings)
}

func (h *AdminHandler) TestOIDCSettings(w http.ResponseWriter, r *http.Request) {
	req, err := h.decodeOIDCTestRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	cfg, err := h.oidcClientConfigForRequest(r, req)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := NewOIDCClient(cfg).TestConnection(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) decodeOIDCTestRequest(r *http.Request) (UpdateOIDCSettingsRequest, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return UpdateOIDCSettingsRequest{}, err
	}
	if strings.TrimSpace(string(body)) == "" {
		settings, err := h.repo.GetOIDCSettings(r.Context(), h.cfg.MasterKey)
		if err != nil {
			return UpdateOIDCSettingsRequest{}, err
		}
		return UpdateOIDCSettingsRequest{
			Enabled:      settings.Enabled,
			IssuerURL:    settings.IssuerURL,
			ClientID:     settings.ClientID,
			RedirectURL:  settings.RedirectURL,
			AuthorizeURL: settings.AuthorizeURL,
			TokenURL:     settings.TokenURL,
			UserInfoURL:  settings.UserInfoURL,
			Scopes:       settings.Scopes,
		}, nil
	}
	var req UpdateOIDCSettingsRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return UpdateOIDCSettingsRequest{}, errors.New("invalid json body")
	}
	return req, nil
}

func (h *AdminHandler) oidcClientConfigForRequest(r *http.Request, req UpdateOIDCSettingsRequest) (OIDCClientConfig, error) {
	req, err := normalizeOIDCSettingsRequest(req)
	if err != nil {
		return OIDCClientConfig{}, err
	}
	if !req.Enabled {
		return OIDCClientConfig{}, errors.New("oidc must be enabled before testing")
	}

	current, err := h.repo.GetOIDCSettings(r.Context(), h.cfg.MasterKey)
	if err != nil {
		return OIDCClientConfig{}, err
	}
	clientSecret := current.ClientSecret
	if req.ClientSecret != nil {
		clientSecret = strings.TrimSpace(*req.ClientSecret)
	}

	cfg := OIDCClientConfig{
		IssuerURL:    req.IssuerURL,
		ClientID:     req.ClientID,
		ClientSecret: clientSecret,
		RedirectURL:  req.RedirectURL,
		AuthorizeURL: req.AuthorizeURL,
		TokenURL:     req.TokenURL,
		UserInfoURL:  req.UserInfoURL,
		Scopes:       normalizeScopes(req.Scopes),
	}
	return completeOIDCClientConfig(cfg), nil
}

func normalizeOIDCSettingsRequest(req UpdateOIDCSettingsRequest) (UpdateOIDCSettingsRequest, error) {
	req.IssuerURL = strings.TrimSpace(req.IssuerURL)
	req.ClientID = strings.TrimSpace(req.ClientID)
	req.RedirectURL = strings.TrimSpace(req.RedirectURL)
	req.AuthorizeURL = strings.TrimSpace(req.AuthorizeURL)
	req.TokenURL = strings.TrimSpace(req.TokenURL)
	req.UserInfoURL = strings.TrimSpace(req.UserInfoURL)
	req.Scopes = normalizeScopes(req.Scopes)

	if req.Enabled {
		if req.ClientID == "" || req.RedirectURL == "" {
			return req, errors.New("client_id and redirect_url are required when enabled")
		}
		if req.AuthorizeURL == "" {
			if req.IssuerURL == "" {
				return req, errors.New("authorize_url or issuer_url is required when enabled")
			}
			req.AuthorizeURL = strings.TrimRight(req.IssuerURL, "/") + "/authorize"
		}
		if req.TokenURL == "" {
			if req.IssuerURL == "" {
				return req, errors.New("token_url or issuer_url is required when enabled")
			}
			req.TokenURL = strings.TrimRight(req.IssuerURL, "/") + "/token"
		}
		if req.UserInfoURL == "" {
			if req.IssuerURL == "" {
				return req, errors.New("userinfo_url or issuer_url is required when enabled")
			}
			req.UserInfoURL = strings.TrimRight(req.IssuerURL, "/") + "/userinfo"
		}
	}

	return req, nil
}

func (h *AdminHandler) writeConfigAudit(r *http.Request, action, resourceType, resourceID string, details map[string]any) {
	identity, _ := IdentityFromContext(r.Context())
	_ = h.repo.WriteAuditLog(
		r.Context(),
		identity.User.ID,
		identity.User.OIDCSubject,
		action,
		resourceType,
		resourceID,
		"success",
		r.RemoteAddr,
		r.UserAgent(),
		requestID(r),
		details,
	)
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
