package iam

import (
	"encoding/json"
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
	oidc       *OIDCClient
	stateStore *OIDCStateStore
}

func NewHandler(cfg config.Config, repo *Repository) *Handler {
	return &Handler{
		cfg:        cfg,
		repo:       repo,
		tokens:     NewTokenService(cfg.MasterKey),
		oidc:       NewOIDCClient(cfg),
		stateStore: NewOIDCStateStore(),
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/oidc/login", h.OIDCLogin)
	r.Get("/oidc/callback", h.OIDCCallback)
	r.With(AuthMiddleware(h.tokens, h.repo)).Get("/me", h.Me)
	return r
}

func (h *Handler) OIDCLogin(w http.ResponseWriter, r *http.Request) {
	if !h.oidc.Enabled() {
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

	authURL, err := h.oidc.BuildAuthorizationURL(state, BuildCodeChallenge(codeVerifier))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *Handler) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	if !h.oidc.Enabled() {
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

	accessToken, err := h.oidc.ExchangeCode(r.Context(), code, stateData.CodeVerifier)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	profile, err := h.oidc.UserInfo(r.Context(), accessToken)
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
		map[string]any{"provider": h.cfg.OIDCIssuerURL},
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
