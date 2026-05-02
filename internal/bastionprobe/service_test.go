package bastionprobe

import (
	"context"
	"strings"
	"testing"
	"time"

	"ops-platform/internal/cmdb"
)

// When a connection profile has proxy_id set but the resolved proxy struct
// is missing (deleted, decryption failed, etc.), every dial path must fail
// closed instead of silently using a direct connection that bypasses the
// bastion. The guard runs before any external dependency, so an empty
// Service is fine.

func TestDialSSH_ProxyRequired_FailsClosed(t *testing.T) {
	s := &Service{}
	target := cmdb.BastionProbeTarget{
		AssetID:       "asset-1",
		Protocol:      "ssh",
		Host:          "10.0.0.5",
		Port:          22,
		Username:      "ec2-user",
		AuthType:      "password",
		Password:      "p",
		ProxyRequired: true,
	}
	_, err := s.dialSSH(context.Background(), target, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected error when proxy required but missing, got nil")
	}
	if !strings.Contains(err.Error(), "requires bastion proxy") {
		t.Fatalf("error should mention proxy, got: %v", err)
	}
}

func TestDialPostgres_ProxyRequired_FailsClosed(t *testing.T) {
	s := &Service{}
	target := cmdb.BastionProbeTarget{
		AssetID:       "asset-2",
		Protocol:      "postgres",
		Host:          "10.0.0.6",
		Port:          5432,
		Username:      "u",
		Password:      "p",
		ProxyRequired: true,
	}
	conn, cleanup, err := s.dialPostgres(context.Background(), target, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected error when proxy required but missing, got nil")
	}
	if conn != nil {
		t.Fatal("expected nil conn on guard failure")
	}
	if cleanup == nil {
		t.Fatal("cleanup must always be non-nil so callers can defer it unconditionally")
	}
	cleanup()
	if !strings.Contains(err.Error(), "requires bastion proxy") {
		t.Fatalf("error should mention proxy, got: %v", err)
	}
}

// dialPostgres should always return a callable cleanup, even on the no-proxy
// failure branch, so callers can defer it without nil checks. This pins the
// contract that the cleanup func is unconditional.
func TestDialPostgres_NoProxy_CleanupAlwaysSafe(t *testing.T) {
	s := &Service{}
	target := cmdb.BastionProbeTarget{
		AssetID:  "asset-3",
		Protocol: "postgres",
		Host:     "127.0.0.1",
		Port:     1, // unreachable; ConnectConfig fails fast
		Username: "u",
		Password: "p",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, cleanup, err := s.dialPostgres(ctx, target, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected dial error on unreachable port")
	}
	if cleanup == nil {
		t.Fatal("cleanup must be non-nil even on connect failure")
	}
	cleanup() // no-op, must not panic
}
