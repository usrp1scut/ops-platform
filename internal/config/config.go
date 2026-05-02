package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr               string
	DatabaseURL            string
	MasterKey              string
	LocalAdminUsername     string
	LocalAdminPassword     string
	OIDCIssuerURL          string
	OIDCClientID           string
	OIDCClientSecret       string
	OIDCRedirectURL        string
	OIDCAuthorizeURL       string
	OIDCTokenURL           string
	OIDCUserInfoURL        string
	OIDCScopes             []string
	OIDCBootstrapAdminSubs []string
	SyncInterval           time.Duration
	SyncRunOnStart         bool
	ProbeInterval          time.Duration
	ProbeRunOnStart        bool
	ProbeTimeout           time.Duration
	ProbeConcurrency       int
	ProbeBatchSize         int
	GuacdAddr              string
	GuacTunnelHost         string

	// Recording storage. When RecordingEnabled is false (no endpoint configured)
	// terminal sessions run normally but no asciinema cast is captured. The
	// SSL/path-style flags handle MinIO-vs-AWS-S3 differences.
	RecordingEnabled  bool
	RecordingEndpoint string
	RecordingAccessID string
	RecordingSecret   string
	RecordingBucket   string
	RecordingRegion   string
	RecordingUseSSL   bool
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:               getenv("OPS_HTTP_ADDR", ":8080"),
		DatabaseURL:            os.Getenv("OPS_DATABASE_URL"),
		MasterKey:              strings.TrimSpace(os.Getenv("OPS_MASTER_KEY")),
		LocalAdminUsername:     strings.TrimSpace(getenv("OPS_LOCAL_ADMIN_USERNAME", "admin")),
		LocalAdminPassword:     getenv("OPS_LOCAL_ADMIN_PASSWORD", "admin123456"),
		OIDCIssuerURL:          strings.TrimSpace(os.Getenv("OPS_OIDC_ISSUER_URL")),
		OIDCClientID:           strings.TrimSpace(os.Getenv("OPS_OIDC_CLIENT_ID")),
		OIDCClientSecret:       strings.TrimSpace(os.Getenv("OPS_OIDC_CLIENT_SECRET")),
		OIDCRedirectURL:        strings.TrimSpace(os.Getenv("OPS_OIDC_REDIRECT_URL")),
		OIDCAuthorizeURL:       strings.TrimSpace(os.Getenv("OPS_OIDC_AUTHORIZE_URL")),
		OIDCTokenURL:           strings.TrimSpace(os.Getenv("OPS_OIDC_TOKEN_URL")),
		OIDCUserInfoURL:        strings.TrimSpace(os.Getenv("OPS_OIDC_USERINFO_URL")),
		OIDCScopes:             parseCSV(getenv("OPS_OIDC_SCOPES", "openid,profile,email")),
		OIDCBootstrapAdminSubs: parseCSV(strings.TrimSpace(os.Getenv("OPS_OIDC_BOOTSTRAP_ADMIN_SUBS"))),
		SyncRunOnStart:         !strings.EqualFold(strings.TrimSpace(getenv("OPS_SYNC_RUN_ON_START", "true")), "false"),
		ProbeRunOnStart:        !strings.EqualFold(strings.TrimSpace(getenv("OPS_PROBE_RUN_ON_START", "true")), "false"),
		GuacdAddr:              strings.TrimSpace(getenv("OPS_GUACD_ADDR", "127.0.0.1:4822")),
		GuacTunnelHost:         strings.TrimSpace(os.Getenv("OPS_GUAC_TUNNEL_HOST")),
		RecordingEndpoint:      strings.TrimSpace(os.Getenv("OPS_RECORDING_ENDPOINT")),
		RecordingAccessID:      strings.TrimSpace(os.Getenv("OPS_RECORDING_ACCESS_KEY")),
		RecordingSecret:        os.Getenv("OPS_RECORDING_SECRET_KEY"),
		RecordingBucket:        strings.TrimSpace(getenv("OPS_RECORDING_BUCKET", "ops-platform-recordings")),
		RecordingRegion:        strings.TrimSpace(getenv("OPS_RECORDING_REGION", "us-east-1")),
		RecordingUseSSL:        strings.EqualFold(strings.TrimSpace(getenv("OPS_RECORDING_USE_SSL", "false")), "true"),
	}
	cfg.RecordingEnabled = cfg.RecordingEndpoint != "" && cfg.RecordingAccessID != "" && cfg.RecordingSecret != ""

	intervalText := strings.TrimSpace(getenv("OPS_SYNC_INTERVAL", "15m"))
	interval, err := time.ParseDuration(intervalText)
	if err != nil {
		return Config{}, fmt.Errorf("invalid OPS_SYNC_INTERVAL: %w", err)
	}
	if interval < time.Minute {
		return Config{}, errors.New("OPS_SYNC_INTERVAL must be >= 1m")
	}
	cfg.SyncInterval = interval

	probeIntervalText := strings.TrimSpace(getenv("OPS_PROBE_INTERVAL", "30m"))
	probeInterval, err := time.ParseDuration(probeIntervalText)
	if err != nil {
		return Config{}, fmt.Errorf("invalid OPS_PROBE_INTERVAL: %w", err)
	}
	if probeInterval < time.Minute {
		return Config{}, errors.New("OPS_PROBE_INTERVAL must be >= 1m")
	}
	cfg.ProbeInterval = probeInterval

	probeTimeoutText := strings.TrimSpace(getenv("OPS_PROBE_TIMEOUT", "20s"))
	probeTimeout, err := time.ParseDuration(probeTimeoutText)
	if err != nil {
		return Config{}, fmt.Errorf("invalid OPS_PROBE_TIMEOUT: %w", err)
	}
	if probeTimeout < 5*time.Second {
		return Config{}, errors.New("OPS_PROBE_TIMEOUT must be >= 5s")
	}
	cfg.ProbeTimeout = probeTimeout

	probeConcurrencyText := strings.TrimSpace(getenv("OPS_PROBE_CONCURRENCY", "4"))
	probeConcurrency, err := parsePositiveInt(probeConcurrencyText)
	if err != nil {
		return Config{}, fmt.Errorf("invalid OPS_PROBE_CONCURRENCY: %w", err)
	}
	if probeConcurrency > 32 {
		return Config{}, errors.New("OPS_PROBE_CONCURRENCY must be <= 32")
	}
	cfg.ProbeConcurrency = probeConcurrency

	probeBatchSizeText := strings.TrimSpace(getenv("OPS_PROBE_BATCH_SIZE", "200"))
	probeBatchSize, err := parsePositiveInt(probeBatchSizeText)
	if err != nil {
		return Config{}, fmt.Errorf("invalid OPS_PROBE_BATCH_SIZE: %w", err)
	}
	if probeBatchSize > 1000 {
		return Config{}, errors.New("OPS_PROBE_BATCH_SIZE must be <= 1000")
	}
	cfg.ProbeBatchSize = probeBatchSize

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("OPS_DATABASE_URL is required")
	}
	if cfg.MasterKey == "" {
		return Config{}, errors.New("OPS_MASTER_KEY is required (32 chars)")
	}
	if len(cfg.MasterKey) != 32 {
		return Config{}, fmt.Errorf("OPS_MASTER_KEY must be exactly 32 chars (got %d)", len(cfg.MasterKey))
	}
	if cfg.LocalAdminUsername == "" {
		return Config{}, errors.New("OPS_LOCAL_ADMIN_USERNAME is required")
	}
	if strings.TrimSpace(cfg.LocalAdminPassword) == "" {
		return Config{}, errors.New("OPS_LOCAL_ADMIN_PASSWORD is required")
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

func parsePositiveInt(raw string) (int, error) {
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, err
	}
	if parsed <= 0 {
		return 0, errors.New("must be > 0")
	}
	return parsed, nil
}
