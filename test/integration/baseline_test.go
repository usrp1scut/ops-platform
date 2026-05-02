//go:build integration

package integration

import (
	"net/http"
	"testing"
)

// Phase 0 baseline: the smallest set of routes whose breakage would mean the
// platform is unusable. Every refactor PR should keep these green.

func TestHealthz(t *testing.T) {
	h := Bootstrap(t)
	var body struct {
		Status string `json:"status"`
	}
	saved := h.Token
	h.Token = ""
	defer func() { h.Token = saved }()
	status, err := h.Do(http.MethodGet, "/healthz", nil, &body)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("status=%d", status)
	}
	if body.Status != "ok" {
		t.Fatalf("expected status=ok, got %q", body.Status)
	}
}

func TestLocalLoginIssuesUsableToken(t *testing.T) {
	h := Bootstrap(t)
	if h.Token == "" {
		t.Fatal("bootstrap should have populated a token")
	}
	// Use the token on /auth/me to confirm AuthMiddleware accepts it.
	var me struct {
		User        map[string]any `json:"user"`
		Roles       []any          `json:"roles"`
		Permissions []any          `json:"permissions"`
	}
	status, err := h.Do(http.MethodGet, "/auth/me", nil, &me)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("/auth/me status=%d", status)
	}
	if me.User == nil {
		t.Fatal("/auth/me did not return a user")
	}
	if len(me.Permissions) == 0 {
		t.Fatal("admin should have at least one permission")
	}
}

func TestListAssetsSucceedsForAdmin(t *testing.T) {
	h := Bootstrap(t)
	var body struct {
		Items []any `json:"items"`
		Total int   `json:"total"`
	}
	status, err := h.Do(http.MethodGet, "/api/v1/cmdb/assets?limit=1", nil, &body)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("status=%d", status)
	}
	// Items may be empty on a fresh DB; we only assert the route works.
	if body.Items == nil {
		t.Fatal("expected items field present (may be empty array)")
	}
}

func TestListHostKeysSucceedsForAdmin(t *testing.T) {
	h := Bootstrap(t)
	var body struct {
		Items []any `json:"items"`
	}
	status, err := h.Do(http.MethodGet, "/api/v1/cmdb/hostkeys/", nil, &body)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("status=%d", status)
	}
}

func TestAWSSyncStatusSucceedsForAdmin(t *testing.T) {
	h := Bootstrap(t)
	// Status payload shape is internal; we only require a 200 + parseable JSON.
	var body map[string]any
	status, err := h.Do(http.MethodGet, "/api/v1/aws/sync/status", nil, &body)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("status=%d", status)
	}
}

func TestUnauthorizedRequestRejected(t *testing.T) {
	h := Bootstrap(t)
	saved := h.Token
	h.Token = ""
	defer func() { h.Token = saved }()
	status, err := h.Do(http.MethodGet, "/api/v1/cmdb/assets", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", status)
	}
}

// PATCH tags compatibility regression — old clients still PATCH {"tags": ...}.
// Combined with the unit test on applyLabelsUpdate, this proves the whole
// path (HTTP → handler → repo → SQL → response) round-trips correctly.
func TestPatchAssetTagsBackwardCompat(t *testing.T) {
	h := Bootstrap(t)

	// Create an asset.
	create := map[string]any{
		"type":   "manual",
		"name":   "integration-tags-compat",
		"status": "active",
		"env":    "test",
	}
	var created struct {
		ID string `json:"id"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/cmdb/assets", create, &created)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create status=%d", status)
	}
	if created.ID == "" {
		t.Fatal("create did not return an id")
	}

	// PATCH using the legacy "tags" field. This MUST be applied as labels.
	patch := map[string]any{"tags": map[string]any{"compat-key": "compat-value"}}
	var patched struct {
		Labels map[string]any `json:"labels"`
		Tags   map[string]any `json:"tags"`
	}
	status, err = h.Do(http.MethodPatch, "/api/v1/cmdb/assets/"+created.ID, patch, &patched)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("patch status=%d", status)
	}
	if got, want := patched.Labels["compat-key"], "compat-value"; got != want {
		t.Fatalf("expected labels[compat-key]=%q after PATCH tags, got %v", want, got)
	}

	// Cleanup so reruns stay deterministic.
	_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/assets/"+created.ID, nil, nil)
}
