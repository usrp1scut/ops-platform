package iam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/config"
)

type Handler struct {
	cfg        config.Config
	repo       *Repository
	tokens     *TokenService
	stateStore *OIDCStateStore
}

func NewHandler(cfg config.Config, repo *Repository) *Handler {
	return &Handler{
		cfg:        cfg,
		repo:       repo,
		tokens:     NewTokenService(cfg.MasterKey),
		stateStore: NewOIDCStateStore(),
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/local/login", h.LocalLogin)
	r.Get("/oidc/login", h.OIDCLogin)
	r.Get("/oidc/callback", h.OIDCCallback)
	r.With(AuthMiddleware(h.tokens, h.repo)).Get("/me", h.Me)
	return r
}

func (h *Handler) LocalLogin(w http.ResponseWriter, r *http.Request) {
	var req LocalLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Password = strings.TrimSpace(req.Password)
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}
	if strings.ToLower(req.Username) != strings.ToLower(h.cfg.LocalAdminUsername) {
		writeError(w, http.StatusUnauthorized, ErrInvalidCredentials.Error())
		return
	}

	if err := h.repo.EnsureLocalAdmin(r.Context(), h.cfg.LocalAdminUsername, h.cfg.LocalAdminPassword); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	identity, err := h.repo.LocalLogin(r.Context(), req.Username, req.Password)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	token, err := h.tokens.Issue(identity, 8*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	_ = h.repo.WriteAuditLog(
		r.Context(),
		identity.User.ID,
		identity.User.OIDCSubject,
		"login",
		"auth",
		"local",
		"success",
		r.RemoteAddr,
		r.UserAgent(),
		requestID(r),
		map[string]any{"username": req.Username},
	)

	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   8 * 3600,
		"user":         identity.User,
		"roles":        identity.Roles,
		"permissions":  identity.Permissions,
	})
}

func (h *Handler) OIDCLogin(w http.ResponseWriter, r *http.Request) {
	oidcClient, _, err := h.oidcClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !oidcClient.Enabled() {
		writeError(w, http.StatusNotImplemented, "oidc is not configured")
		return
	}

	state, err := GenerateState()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate state")
		return
	}
	codeVerifier, err := GenerateCodeVerifier()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate code verifier")
		return
	}
	h.stateStore.Save(state, oidcStateData{
		CodeVerifier: codeVerifier,
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	})

	authURL, err := oidcClient.BuildAuthorizationURL(state, BuildCodeChallenge(codeVerifier))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *Handler) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	oidcClient, oidcCfg, err := h.oidcClient(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !oidcClient.Enabled() {
		writeError(w, http.StatusNotImplemented, "oidc is not configured")
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		writeError(w, http.StatusBadRequest, "missing code or state")
		return
	}

	stateData, ok := h.stateStore.Consume(state)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid or expired state")
		return
	}

	accessToken, err := oidcClient.ExchangeCode(r.Context(), code, stateData.CodeVerifier)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	profile, err := oidcClient.UserInfo(r.Context(), accessToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	user, err := h.repo.UpsertUser(r.Context(), profile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.repo.EnsureAdminBinding(r.Context(), user.ID, h.cfg.OIDCBootstrapAdminSubs, user.OIDCSubject); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	identity, err := h.repo.IdentityForUser(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	token, err := h.tokens.Issue(identity, 8*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	_ = h.repo.WriteAuditLog(
		r.Context(),
		identity.User.ID,
		identity.User.OIDCSubject,
		"login",
		"auth",
		"oidc",
		"success",
		r.RemoteAddr,
		r.UserAgent(),
		requestID(r),
		map[string]any{"provider": oidcCfg.OIDCIssuerURL},
	)

	response := map[string]any{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   8 * 3600,
		"user":         identity.User,
		"roles":        identity.Roles,
		"permissions":  identity.Permissions,
	}

	accept := strings.ToLower(r.Header.Get("Accept"))
	if strings.Contains(accept, "text/html") {
		tokenJSON, _ := json.Marshal(token)
		html := fmt.Sprintf(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>OIDC Login Complete</title></head>
  <body>
    <script>
      localStorage.setItem("ops_platform_access_token", %s);
      window.location.href = "/ui/";
    </script>
    <p>Login complete. Redirecting...</p>
  </body>
</html>`, string(tokenJSON))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(html))
		return
	}

	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) oidcClient(ctx context.Context) (*OIDCClient, config.Config, error) {
	settings, err := h.repo.GetOIDCSettings(ctx, h.cfg.MasterKey)
	if err != nil {
		return nil, config.Config{}, err
	}

	effective := h.cfg
	if settings.Exists {
		effective.OIDCIssuerURL = strings.TrimSpace(settings.IssuerURL)
		effective.OIDCClientID = strings.TrimSpace(settings.ClientID)
		effective.OIDCClientSecret = settings.ClientSecret
		effective.OIDCRedirectURL = strings.TrimSpace(settings.RedirectURL)
		effective.OIDCAuthorizeURL = strings.TrimSpace(settings.AuthorizeURL)
		effective.OIDCTokenURL = strings.TrimSpace(settings.TokenURL)
		effective.OIDCUserInfoURL = strings.TrimSpace(settings.UserInfoURL)
		effective.OIDCScopes = normalizeScopes(settings.Scopes)
		if !settings.Enabled {
			effective.OIDCClientID = ""
			effective.OIDCRedirectURL = ""
		}
	}

	if effective.OIDCClientID != "" && effective.OIDCRedirectURL != "" {
		if effective.OIDCAuthorizeURL == "" && effective.OIDCIssuerURL != "" {
			effective.OIDCAuthorizeURL = strings.TrimRight(effective.OIDCIssuerURL, "/") + "/authorize"
		}
		if effective.OIDCTokenURL == "" && effective.OIDCIssuerURL != "" {
			effective.OIDCTokenURL = strings.TrimRight(effective.OIDCIssuerURL, "/") + "/token"
		}
		if effective.OIDCUserInfoURL == "" && effective.OIDCIssuerURL != "" {
			effective.OIDCUserInfoURL = strings.TrimRight(effective.OIDCIssuerURL, "/") + "/userinfo"
		}
	}

	return NewOIDCClient(effective), effective, nil
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	identity, ok := IdentityFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":        identity.User,
		"roles":       identity.Roles,
		"permissions": identity.Permissions,
	})
}
