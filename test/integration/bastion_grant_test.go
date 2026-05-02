//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// JIT bastion access end-to-end. Covers:
//   - admin bypasses the grant gate (existing behavior preserved)
//   - non-admin without a grant → 403 with needs_grant=true
//   - admin grants access → non-admin can issue ticket
//   - revoke → next attempt blocked again
//   - request lifecycle: submit → approve → reject conflict on second decision
//   - self-approval refused

func createTestAsset(t *testing.T, h *Harness, label string) string {
	t.Helper()
	req := map[string]any{
		"type":   "manual",
		"name":   fmt.Sprintf("integration-grant-%s-%d", label, randSuffix()),
		"status": "active",
		"env":    "test",
	}
	var asset struct {
		ID string `json:"id"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/cmdb/assets", req, &asset)
	if err != nil {
		t.Fatal(err)
	}
	if status/100 != 2 {
		t.Fatalf("create asset status=%d", status)
	}
	t.Cleanup(func() {
		_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/assets/"+asset.ID, nil, nil)
	})
	return asset.ID
}

func TestGrantGate_AdminBypassesAndNonAdminBlockedThenAllowed(t *testing.T) {
	h := Bootstrap(t)
	assetID := createTestAsset(t, h, "gate")

	// Admin: ticket issue should succeed without any grant (system:admin
	// bypass).
	var tk struct {
		Ticket string `json:"ticket"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/cmdb/assets/"+assetID+"/terminal/ticket", map[string]any{}, &tk)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("admin ticket issue: expected 200, got %d", status)
	}
	if tk.Ticket == "" {
		t.Fatal("admin ticket issue: empty ticket")
	}

	// Non-admin without a grant: 403 + needs_grant=true.
	userID, userToken := h.NewUser(t, "viewer-jit", "viewer")
	var resp map[string]any
	status, err = h.DoAs(userToken, http.MethodPost, "/api/v1/cmdb/assets/"+assetID+"/terminal/ticket", map[string]any{}, &resp)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusForbidden {
		t.Fatalf("non-admin pre-grant: expected 403, got %d (body=%v)", status, resp)
	}
	if needs, ok := resp["needs_grant"].(bool); !ok || !needs {
		t.Fatalf("non-admin response missing needs_grant=true (body=%v)", resp)
	}

	// Admin grants access for 1h.
	grantReq := map[string]any{
		"user_id":          userID,
		"asset_id":         assetID,
		"reason":           "incident response",
		"duration_seconds": 3600,
	}
	var grant struct {
		ID     string `json:"id"`
		Active bool   `json:"active"`
	}
	status, err = h.Do(http.MethodPost, "/api/v1/bastion/grants", grantReq, &grant)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated {
		t.Fatalf("create grant: expected 201, got %d", status)
	}
	if !grant.Active {
		t.Fatal("freshly created grant should be active")
	}

	// Same non-admin retry: ticket issue now succeeds.
	status, err = h.DoAs(userToken, http.MethodPost, "/api/v1/cmdb/assets/"+assetID+"/terminal/ticket", map[string]any{}, &tk)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("non-admin post-grant: expected 200, got %d", status)
	}

	// Revoke. Next attempt should be blocked again.
	status, err = h.Do(http.MethodDelete, "/api/v1/bastion/grants/"+grant.ID, map[string]any{"reason": "no longer needed"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("revoke grant: expected 200, got %d", status)
	}
	status, _ = h.DoAs(userToken, http.MethodPost, "/api/v1/cmdb/assets/"+assetID+"/terminal/ticket", map[string]any{}, &resp)
	if status != http.StatusForbidden {
		t.Fatalf("non-admin post-revoke: expected 403, got %d", status)
	}
}

func TestRequest_LifecycleAndConflict(t *testing.T) {
	h := Bootstrap(t)
	assetID := createTestAsset(t, h, "request")
	_, userToken := h.NewUser(t, "viewer-req", "viewer")

	// Submit a request as the user.
	var req struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	body := map[string]any{
		"asset_id":         assetID,
		"reason":           "ad-hoc debug",
		"duration_seconds": 1800,
	}
	status, err := h.DoAs(userToken, http.MethodPost, "/api/v1/bastion/requests", body, &req)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated {
		t.Fatalf("submit request: expected 201, got %d", status)
	}
	if req.Status != "pending" {
		t.Fatalf("new request should be pending, got %q", req.Status)
	}

	// Admin rejects.
	var rejected map[string]any
	status, err = h.Do(http.MethodPost, "/api/v1/bastion/requests/"+req.ID+"/reject",
		map[string]any{"reason": "out of policy"}, &rejected)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("reject: expected 200, got %d", status)
	}
	if rejected["status"] != "rejected" {
		t.Fatalf("status should be rejected, got %v", rejected["status"])
	}

	// Second decision must conflict (not idempotent — once decided, locked).
	status, _ = h.Do(http.MethodPost, "/api/v1/bastion/requests/"+req.ID+"/reject",
		map[string]any{"reason": "again"}, nil)
	if status != http.StatusConflict {
		t.Fatalf("second reject: expected 409, got %d", status)
	}
}

// Two-person rule: an approver must not be able to bypass approval by
// directly granting themselves access. ApproveRequest already blocks
// self-approval; createGrant must do the same.
func TestDirectGrant_SelfGrantDenied(t *testing.T) {
	h := Bootstrap(t)
	assetID := createTestAsset(t, h, "self-grant")

	// Look up admin's user_id so we can target it as the grant recipient.
	var me struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	status, err := h.Do(http.MethodGet, "/auth/me", nil, &me)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || me.User.ID == "" {
		t.Fatalf("/auth/me failed: status=%d", status)
	}

	body := map[string]any{
		"user_id":          me.User.ID,
		"asset_id":         assetID,
		"reason":           "self-grant attempt",
		"duration_seconds": 600,
	}
	var resp map[string]any
	status, err = h.Do(http.MethodPost, "/api/v1/bastion/grants", body, &resp)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusForbidden {
		t.Fatalf("self-grant should be 403, got %d (body=%v)", status, resp)
	}
	errMsg, _ := resp["error"].(string)
	if !strings.Contains(errMsg, "yourself") {
		t.Fatalf("expected error to mention self-grant, got %q", errMsg)
	}
}

func TestRequest_ApproveCreatesGrantAndSelfApprovalDenied(t *testing.T) {
	h := Bootstrap(t)
	assetID := createTestAsset(t, h, "self-approve")

	// Admin submits a request as themselves (the self-approve guard target).
	var ownReq struct {
		ID string `json:"id"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/bastion/requests", map[string]any{
		"asset_id":         assetID,
		"reason":           "test",
		"duration_seconds": 600,
	}, &ownReq)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated {
		t.Fatalf("self-submit: expected 201, got %d", status)
	}

	// Admin tries to approve their own request → 403.
	status, _ = h.Do(http.MethodPost, "/api/v1/bastion/requests/"+ownReq.ID+"/approve", map[string]any{}, nil)
	if status != http.StatusForbidden {
		t.Fatalf("self-approve: expected 403, got %d", status)
	}

	// Now do the proper flow: non-admin requests, admin approves.
	_, userToken := h.NewUser(t, "viewer-approve", "viewer")
	var req struct {
		ID string `json:"id"`
	}
	if _, err := h.DoAs(userToken, http.MethodPost, "/api/v1/bastion/requests", map[string]any{
		"asset_id":         assetID,
		"reason":           "approved-flow",
		"duration_seconds": 600,
	}, &req); err != nil {
		t.Fatal(err)
	}
	var approved struct {
		Request struct {
			Status  string `json:"status"`
			GrantID string `json:"grant_id"`
		} `json:"request"`
		Grant struct {
			ID     string `json:"id"`
			Active bool   `json:"active"`
		} `json:"grant"`
	}
	status, err = h.Do(http.MethodPost, "/api/v1/bastion/requests/"+req.ID+"/approve", map[string]any{}, &approved)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("approve: expected 200, got %d", status)
	}
	if approved.Request.Status != "approved" {
		t.Fatalf("request status: expected approved, got %q", approved.Request.Status)
	}
	if approved.Request.GrantID == "" || approved.Request.GrantID != approved.Grant.ID {
		t.Fatalf("grant_id linkage broken: req.grant_id=%q grant.id=%q", approved.Request.GrantID, approved.Grant.ID)
	}
	if !approved.Grant.Active {
		t.Fatal("approved grant should be active")
	}
}
