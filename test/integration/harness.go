//go:build integration

// Package integration is the harness for end-to-end tests against a real
// Postgres. It boots ops-api in-process and exposes a small HTTP client.
//
// Run with: bash scripts/test-integration.sh
//   (or: go test -tags=integration ./test/integration/...)
//
// Environment:
//   OPS_TEST_DATABASE_URL   default: postgres://ops:ops@localhost:5432/ops_platform_test?sslmode=disable
//   OPS_MASTER_KEY          default: 32-char dev key
//   OPS_LOCAL_ADMIN_USERNAME default: admin
//   OPS_LOCAL_ADMIN_PASSWORD default: admin123456
package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"ops-platform/internal/config"
	"ops-platform/internal/httpserver"
	"ops-platform/internal/iam"
)

const (
	defaultDSN          = "postgres://ops:ops@localhost:5432/ops_platform_test?sslmode=disable"
	defaultMasterKey    = "01234567890123456789012345678901"
	defaultAdminUser    = "admin"
	defaultAdminPasswd  = "admin123456"
	migrationsDirectory = "migrations"
)

type Harness struct {
	T       *testing.T
	BaseURL string
	Token   string

	db        *sql.DB
	server    *httptest.Server
	masterKey string
}

// Bootstrap brings up an in-process ops-api against a real Postgres,
// (re-)applies migrations, and authenticates as the local admin so callers
// have a token ready for protected routes. Cleanup is registered with t.
func Bootstrap(t *testing.T) *Harness {
	t.Helper()

	dsn := envOr("OPS_TEST_DATABASE_URL", defaultDSN)
	masterKey := envOr("OPS_MASTER_KEY", defaultMasterKey)
	adminUser := envOr("OPS_LOCAL_ADMIN_USERNAME", defaultAdminUser)
	adminPass := envOr("OPS_LOCAL_ADMIN_PASSWORD", defaultAdminPasswd)

	if err := ensureTestDatabase(dsn); err != nil {
		t.Fatalf("ensure test database: %v", err)
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		t.Skipf("postgres unavailable at %s: %v", dsn, err)
	}

	if err := applyMigrations(db, migrationsDirAbs(t)); err != nil {
		_ = db.Close()
		t.Fatalf("apply migrations: %v", err)
	}

	cfg := config.Config{
		DatabaseURL:        dsn,
		MasterKey:          masterKey,
		LocalAdminUsername: adminUser,
		LocalAdminPassword: adminPass,
		HTTPAddr:           ":0",
		ProbeTimeout:       5 * time.Second,
	}

	server := httptest.NewServer(httpserver.New(cfg, db).Router())

	h := &Harness{
		T:         t,
		BaseURL:   server.URL,
		db:        db,
		server:    server,
		masterKey: masterKey,
	}

	t.Cleanup(func() {
		server.Close()
		_ = db.Close()
	})

	tok, err := h.localLogin(adminUser, adminPass)
	if err != nil {
		t.Fatalf("local admin login: %v", err)
	}
	h.Token = tok
	return h
}

// Do performs an authenticated request and unmarshals the body into out
// (which may be nil to skip decoding). Returns the response status code.
func (h *Harness) Do(method, path string, body, out any) (int, error) {
	h.T.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return 0, fmt.Errorf("marshal body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, h.BaseURL+path, reader)
	if err != nil {
		return 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if h.Token != "" {
		req.Header.Set("Authorization", "Bearer "+h.Token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, err
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return resp.StatusCode, fmt.Errorf("unmarshal: %w (body=%s)", err, string(respBody))
		}
	}
	return resp.StatusCode, nil
}

func (h *Harness) localLogin(user, pass string) (string, error) {
	body := map[string]string{"username": user, "password": pass}
	var resp struct {
		AccessToken string `json:"access_token"`
	}
	saved := h.Token
	h.Token = ""
	defer func() { h.Token = saved }()
	status, err := h.Do(http.MethodPost, "/auth/local/login", body, &resp)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("status=%d", status)
	}
	if resp.AccessToken == "" {
		return "", fmt.Errorf("response missing access_token")
	}
	return resp.AccessToken, nil
}

// NewUser inserts a fresh non-OIDC user, binds them to the named built-in
// role (admin/ops/viewer), and returns (userID, token). The token is signed
// with the same master key as the running server so it passes
// AuthMiddleware. Roles are looked up by name; the migration seeds them.
func (h *Harness) NewUser(t *testing.T, name, role string) (string, string) {
	t.Helper()
	userID := uuid.NewString()
	subject := "test:" + userID
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := h.db.ExecContext(ctx, `
INSERT INTO iam_user (id, oidc_subject, name)
VALUES ($1::uuid, $2, $3)`, userID, subject, name); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := h.db.ExecContext(ctx, `
INSERT INTO iam_user_role_binding (id, user_id, role_id)
SELECT $1::uuid, $2::uuid, r.id FROM iam_role r WHERE r.name = $3`,
		uuid.NewString(), userID, role); err != nil {
		t.Fatalf("bind role: %v", err)
	}
	rows, err := h.db.QueryContext(ctx, `
SELECT DISTINCT rp.resource, rp.action
FROM iam_user_role_binding ub
JOIN iam_role_permission rp ON rp.role_id = ub.role_id
WHERE ub.user_id = $1::uuid`, userID)
	if err != nil {
		t.Fatalf("load perms: %v", err)
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var resource, action string
		if err := rows.Scan(&resource, &action); err != nil {
			t.Fatalf("scan perm: %v", err)
		}
		perms = append(perms, resource+":"+action)
	}
	tokens := iam.NewTokenService(h.masterKey)
	tok, err := tokens.Issue(iam.UserIdentity{
		User:        iam.User{ID: userID, OIDCSubject: subject, Name: name},
		Permissions: perms,
	}, time.Hour)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return userID, tok
}

// DoAs runs a request as a different identity (e.g. a non-admin created via
// NewUser). Restores the previous token after the call.
func (h *Harness) DoAs(token, method, path string, body, out any) (int, error) {
	saved := h.Token
	h.Token = token
	defer func() { h.Token = saved }()
	return h.Do(method, path, body, out)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ensureTestDatabase creates the target database if it does not exist. The
// connect-as-admin assumption matches the local docker-compose stack
// (POSTGRES_USER=ops has CREATEDB).
func ensureTestDatabase(dsn string) error {
	const dbnameMarker = "/"
	idx := strings.LastIndex(dsn, dbnameMarker)
	if idx < 0 {
		return fmt.Errorf("dsn has no database segment: %s", dsn)
	}
	q := strings.IndexByte(dsn[idx:], '?')
	dbname := dsn[idx+1:]
	tail := ""
	if q >= 0 {
		dbname = dsn[idx+1 : idx+q]
		tail = dsn[idx+q:]
	}
	if dbname == "" {
		return fmt.Errorf("dsn has empty database name: %s", dsn)
	}
	adminDSN := dsn[:idx+1] + "postgres" + tail
	admin, err := sql.Open("pgx", adminDSN)
	if err != nil {
		return fmt.Errorf("open admin db: %w", err)
	}
	defer admin.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := admin.PingContext(ctx); err != nil {
		return fmt.Errorf("ping admin db: %w", err)
	}
	var exists bool
	if err := admin.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", dbname).Scan(&exists); err != nil {
		return fmt.Errorf("probe database: %w", err)
	}
	if exists {
		return nil
	}
	// Quoted identifier; dbname is sourced from env/literal config.
	if _, err := admin.ExecContext(ctx, fmt.Sprintf(`CREATE DATABASE %q`, dbname)); err != nil {
		return fmt.Errorf("create database %s: %w", dbname, err)
	}
	return nil
}

// applyMigrations runs every *.sql file in dir in lexical order, in a single
// transaction. The migrations are idempotent (IF NOT EXISTS guards); rerunning
// is safe and is the way the test harness keeps the schema fresh between runs.
func applyMigrations(db *sql.DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, n := range names {
		body, err := os.ReadFile(filepath.Join(dir, n))
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("read %s: %w", n, err)
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec %s: %w", n, err)
		}
	}
	return tx.Commit()
}

// migrationsDirAbs locates the migrations/ directory by walking up from this
// source file. Lets `go test ./test/integration/...` work regardless of the
// caller's CWD.
func migrationsDirAbs(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// test/integration/harness.go → repo root is two levels up.
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	return filepath.Join(root, migrationsDirectory)
}
