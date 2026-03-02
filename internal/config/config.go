package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	MasterKey   string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:    getenv("OPS_HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("OPS_DATABASE_URL"),
		MasterKey:   strings.TrimSpace(os.Getenv("OPS_MASTER_KEY")),
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

	return cfg, nil
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
