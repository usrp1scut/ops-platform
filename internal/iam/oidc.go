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
	// Prune expired entries on every write to prevent unbounded growth.
	now := time.Now()
	for k, v := range s.items {
		if now.After(v.ExpiresAt) {
			delete(s.items, k)
		}
	}
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
	cfg        OIDCClientConfig
	httpClient *http.Client
}

type OIDCClientConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	AuthorizeURL string
	TokenURL     string
	UserInfoURL  string
	Scopes       []string
}

type OIDCConnectionTestResult struct {
	Status         string    `json:"status"`
	AuthorizeURL   string    `json:"authorize_url"`
	HTTPStatusCode int       `json:"http_status_code"`
	HTTPStatus     string    `json:"http_status"`
	CheckedAt      time.Time `json:"checked_at"`
}

func NewOIDCClient(cfg OIDCClientConfig) *OIDCClient {
	return &OIDCClient{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *OIDCClient) Enabled() bool {
	return c.cfg.ClientID != "" && c.cfg.RedirectURL != ""
}

func (c *OIDCClient) BuildAuthorizationURL(state string, codeChallenge string) (string, error) {
	if !c.Enabled() {
		return "", errors.New("oidc is not configured")
	}
	u, err := url.Parse(c.cfg.AuthorizeURL)
	if err != nil {
		return "", fmt.Errorf("invalid authorize url: %w", err)
	}
	q := u.Query()
	q.Set("client_id", c.cfg.ClientID)
	q.Set("redirect_uri", c.cfg.RedirectURL)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(c.cfg.Scopes, " "))
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
	form.Set("redirect_uri", c.cfg.RedirectURL)
	form.Set("client_id", c.cfg.ClientID)
	if c.cfg.ClientSecret != "" {
		form.Set("client_secret", c.cfg.ClientSecret)
	}
	form.Set("code_verifier", codeVerifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
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
	if c.cfg.UserInfoURL == "" {
		return UserProfile{}, errors.New("oidc userinfo_url is required for user sync")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.UserInfoURL, nil)
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

func (c *OIDCClient) TestConnection(ctx context.Context) (OIDCConnectionTestResult, error) {
	state, err := GenerateState()
	if err != nil {
		return OIDCConnectionTestResult{}, err
	}
	verifier, err := GenerateCodeVerifier()
	if err != nil {
		return OIDCConnectionTestResult{}, err
	}
	authURL, err := c.BuildAuthorizationURL(state, BuildCodeChallenge(verifier))
	if err != nil {
		return OIDCConnectionTestResult{}, err
	}

	client := *c.httpClient
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authURL, nil)
	if err != nil {
		return OIDCConnectionTestResult{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return OIDCConnectionTestResult{}, err
	}
	defer resp.Body.Close()

	result := OIDCConnectionTestResult{
		Status:         "ok",
		AuthorizeURL:   c.cfg.AuthorizeURL,
		HTTPStatusCode: resp.StatusCode,
		HTTPStatus:     resp.Status,
		CheckedAt:      time.Now(),
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return result, fmt.Errorf("authorize endpoint returned %s", resp.Status)
	}
	return result, nil
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
