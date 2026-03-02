package iam

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"ops-platform/internal/config"
)

type oidcStateData struct {
	CodeVerifier  string
	RedirectAfter string
	ExpiresAt     time.Time
}

type OIDCStateStore struct {
	mu    sync.Mutex
	items map[string]oidcStateData
}

func NewOIDCStateStore() *OIDCStateStore {
	return &OIDCStateStore{
		items: make(map[string]oidcStateData),
	}
}

func (s *OIDCStateStore) Save(state string, data oidcStateData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[state] = data
}

func (s *OIDCStateStore) Consume(state string) (oidcStateData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.items[state]
	if !ok {
		return oidcStateData{}, false
	}
	delete(s.items, state)
	if time.Now().After(data.ExpiresAt) {
		return oidcStateData{}, false
	}
	return data, true
}

type OIDCClient struct {
	cfg        config.Config
	httpClient *http.Client
}

func NewOIDCClient(cfg config.Config) *OIDCClient {
	return &OIDCClient{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *OIDCClient) Enabled() bool {
	return c.cfg.OIDCClientID != "" && c.cfg.OIDCRedirectURL != ""
}

func (c *OIDCClient) BuildAuthorizationURL(state string, codeChallenge string) (string, error) {
	if !c.Enabled() {
		return "", errors.New("oidc is not configured")
	}
	u, err := url.Parse(c.cfg.OIDCAuthorizeURL)
	if err != nil {
		return "", fmt.Errorf("invalid authorize url: %w", err)
	}
	q := u.Query()
	q.Set("client_id", c.cfg.OIDCClientID)
	q.Set("redirect_uri", c.cfg.OIDCRedirectURL)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(c.cfg.OIDCScopes, " "))
	q.Set("state", state)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (c *OIDCClient) ExchangeCode(ctx context.Context, code string, codeVerifier string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", c.cfg.OIDCRedirectURL)
	form.Set("client_id", c.cfg.OIDCClientID)
	if c.cfg.OIDCClientSecret != "" {
		form.Set("client_secret", c.cfg.OIDCClientSecret)
	}
	form.Set("code_verifier", codeVerifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.OIDCTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token endpoint failed: %s", strings.TrimSpace(string(body)))
	}

	var payload struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if payload.AccessToken == "" {
		return "", errors.New("token endpoint response missing access_token")
	}
	return payload.AccessToken, nil
}

func (c *OIDCClient) UserInfo(ctx context.Context, accessToken string) (UserProfile, error) {
	if c.cfg.OIDCUserInfoURL == "" {
		return UserProfile{}, errors.New("OPS_OIDC_USERINFO_URL is required for user sync")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.OIDCUserInfoURL, nil)
	if err != nil {
		return UserProfile{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return UserProfile{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return UserProfile{}, fmt.Errorf("userinfo endpoint failed: %s", strings.TrimSpace(string(body)))
	}

	var profile UserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return UserProfile{}, err
	}
	if profile.Subject == "" {
		return UserProfile{}, errors.New("userinfo missing sub")
	}
	return profile, nil
}

func GenerateState() (string, error) {
	return randomString(32)
}

func GenerateCodeVerifier() (string, error) {
	return randomString(64)
}

func BuildCodeChallenge(codeVerifier string) string {
	hash := sha256.Sum256([]byte(codeVerifier))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

func randomString(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
