package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	HTTPAddr               string
	DatabaseURL            string
	MasterKey              string
	OIDCIssuerURL          string
	OIDCClientID           string
	OIDCClientSecret       string
	OIDCRedirectURL        string
	OIDCAuthorizeURL       string
	OIDCTokenURL           string
	OIDCUserInfoURL        string
	OIDCScopes             []string
	OIDCBootstrapAdminSubs []string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:               getenv("OPS_HTTP_ADDR", ":8080"),
		DatabaseURL:            os.Getenv("OPS_DATABASE_URL"),
		MasterKey:              strings.TrimSpace(os.Getenv("OPS_MASTER_KEY")),
		OIDCIssuerURL:          strings.TrimSpace(os.Getenv("OPS_OIDC_ISSUER_URL")),
		OIDCClientID:           strings.TrimSpace(os.Getenv("OPS_OIDC_CLIENT_ID")),
		OIDCClientSecret:       strings.TrimSpace(os.Getenv("OPS_OIDC_CLIENT_SECRET")),
		OIDCRedirectURL:        strings.TrimSpace(os.Getenv("OPS_OIDC_REDIRECT_URL")),
		OIDCAuthorizeURL:       strings.TrimSpace(os.Getenv("OPS_OIDC_AUTHORIZE_URL")),
		OIDCTokenURL:           strings.TrimSpace(os.Getenv("OPS_OIDC_TOKEN_URL")),
		OIDCUserInfoURL:        strings.TrimSpace(os.Getenv("OPS_OIDC_USERINFO_URL")),
		OIDCScopes:             parseCSV(getenv("OPS_OIDC_SCOPES", "openid,profile,email")),
		OIDCBootstrapAdminSubs: parseCSV(strings.TrimSpace(os.Getenv("OPS_OIDC_BOOTSTRAP_ADMIN_SUBS"))),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("OPS_DATABASE_URL is required")
	}
	if cfg.MasterKey == "" {
		return Config{}, errors.New("OPS_MASTER_KEY is required (32 chars)")
	}
	if len(cfg.MasterKey) != 32 {
		return Config{}, fmt.Errorf("OPS_MASTER_KEY must be exactly 32 chars (got %d)", len(cfg.MasterKey))
	}
	if cfg.OIDCClientID != "" || cfg.OIDCRedirectURL != "" {
		if cfg.OIDCClientID == "" || cfg.OIDCRedirectURL == "" {
			return Config{}, errors.New("OPS_OIDC_CLIENT_ID and OPS_OIDC_REDIRECT_URL must be set together")
		}
		if cfg.OIDCAuthorizeURL == "" {
			if cfg.OIDCIssuerURL == "" {
				return Config{}, errors.New("set OPS_OIDC_AUTHORIZE_URL or OPS_OIDC_ISSUER_URL")
			}
			cfg.OIDCAuthorizeURL = strings.TrimRight(cfg.OIDCIssuerURL, "/") + "/authorize"
		}
		if cfg.OIDCTokenURL == "" {
			if cfg.OIDCIssuerURL == "" {
				return Config{}, errors.New("set OPS_OIDC_TOKEN_URL or OPS_OIDC_ISSUER_URL")
			}
			cfg.OIDCTokenURL = strings.TrimRight(cfg.OIDCIssuerURL, "/") + "/token"
		}
		if cfg.OIDCUserInfoURL == "" && cfg.OIDCIssuerURL != "" {
			cfg.OIDCUserInfoURL = strings.TrimRight(cfg.OIDCIssuerURL, "/") + "/userinfo"
		}
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func parseCSV(input string) []string {
	if strings.TrimSpace(input) == "" {
		return nil
	}
	items := strings.Split(input, ",")
	values := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	return values
}
