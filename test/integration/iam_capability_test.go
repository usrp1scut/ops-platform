//go:build integration

package integration

import (
	"net/http"
	"testing"
)

func TestIAMCapabilityCatalog_IncludesGrantOnlySessionCapabilities(t *testing.T) {
	h := Bootstrap(t)

	var resp struct {
		Items []struct {
			Permission string `json:"permission"`
		} `json:"items"`
	}
	status, err := h.Do(http.MethodGet, "/api/v1/iam/capabilities", nil, &resp)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("list capabilities: expected 200, got %d", status)
	}

	seen := map[string]bool{}
	for _, item := range resp.Items {
		seen[item.Permission] = true
	}
	for _, permission := range []string{"bastion.session:connect"} {
		if !seen[permission] {
			t.Fatalf("authoritative capability catalog is missing %s", permission)
		}
	}
}

func TestIAMCapabilityPrincipals_CountDistinctUsersAcrossRoles(t *testing.T) {
	h := Bootstrap(t)
	userID, _ := h.NewUser(t, "multi-role-principal", "ops")
	if _, err := h.db.Exec(`
INSERT INTO iam_user_role_binding (user_id, role_id)
SELECT $1::uuid, r.id
FROM iam_role r
WHERE r.name = 'viewer'
ON CONFLICT (user_id, role_id) DO NOTHING`, userID); err != nil {
		t.Fatalf("bind second role: %v", err)
	}

	var expectedUsers int
	if err := h.db.QueryRow(`
SELECT count(DISTINCT b.user_id)
FROM iam_role_permission rp
JOIN iam_user_role_binding b ON b.role_id = rp.role_id
WHERE rp.resource = 'cmdb.asset' AND rp.action = 'read'`).Scan(&expectedUsers); err != nil {
		t.Fatalf("count distinct principals: %v", err)
	}

	var resp struct {
		Summary struct {
			Users int `json:"users"`
		} `json:"summary"`
	}
	status, err := h.Do(http.MethodGet, "/api/v1/iam/capabilities/cmdb.asset%3Aread/principals", nil, &resp)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("principals: expected 200, got %d", status)
	}
	if resp.Summary.Users != expectedUsers {
		t.Fatalf("principal summary users=%d, want distinct count %d", resp.Summary.Users, expectedUsers)
	}
}
