//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// End-to-end check for the P1 fail-closed behavior introduced after the code
// review (see ADR-0006). When an asset's connection profile carries a
// proxy_id whose proxy row has been soft-deleted, every dial path must error
// — never silently fall back to a direct connection. This wires together:
// API → handler → cmdb.Repository.GetBastionProbeTarget → bastionprobe.dialSSH.
//
// DeleteSSHProxy soft-deletes (UPDATE deleted_at), so the FK link stays
// intact but GetSSHProxyTarget filters the row out, exercising the exact
// path the review flagged.
func TestProxyDeletedFailsClosed(t *testing.T) {
	h := Bootstrap(t)

	// 1. Create a proxy. The host will never be dialed because the test
	//    never gets past the proxy-resolution guard, so any string works.
	proxyReq := map[string]any{
		"name":         fmt.Sprintf("integration-fail-closed-%d", randSuffix()),
		"network_zone": "test",
		"host":         "127.0.0.1",
		"port":         22,
		"username":     "ops",
		"auth_type":    "password",
		"password":     "irrelevant",
	}
	var proxy struct {
		ID string `json:"id"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/cmdb/ssh-proxies/", proxyReq, &proxy)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create proxy status=%d", status)
	}
	if proxy.ID == "" {
		t.Fatal("create proxy returned no id")
	}

	// 2. Create an asset.
	assetReq := map[string]any{
		"type":   "manual",
		"name":   fmt.Sprintf("integration-fail-closed-asset-%d", randSuffix()),
		"status": "active",
		"env":    "test",
	}
	var asset struct {
		ID string `json:"id"`
	}
	status, err = h.Do(http.MethodPost, "/api/v1/cmdb/assets", assetReq, &asset)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create asset status=%d", status)
	}

	// Always clean up.
	t.Cleanup(func() {
		_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/assets/"+asset.ID, nil, nil)
		_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/ssh-proxies/"+proxy.ID, nil, nil)
	})

	// 3. Wire the asset's connection profile to use the proxy.
	connReq := map[string]any{
		"protocol":  "ssh",
		"host":      "10.255.255.1", // RFC 5737 not-routable; ensures we fail-close, not by network reachability
		"port":      22,
		"username":  "ops",
		"auth_type": "password",
		"password":  "irrelevant",
		"proxy_id":  proxy.ID,
	}
	status, err = h.Do(http.MethodPut, "/api/v1/cmdb/assets/"+asset.ID+"/connection", connReq, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("upsert connection status=%d", status)
	}

	// 4. Soft-delete the proxy. FK is ON DELETE SET NULL but DeleteSSHProxy
	//    only updates deleted_at, so the proxy_id column on the asset's
	//    connection still references the (now soft-deleted) proxy row.
	status, err = h.Do(http.MethodDelete, "/api/v1/cmdb/ssh-proxies/"+proxy.ID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("delete proxy status=%d", status)
	}

	// 5. Test the connection. Pre-fix, this silently dialed directly to
	//    10.255.255.1 and timed out. Post-fix, GetBastionProbeTarget
	//    surfaces the proxy lookup failure with a recognizable message.
	var resp map[string]any
	status, err = h.Do(http.MethodPost, "/api/v1/cmdb/assets/"+asset.ID+"/connection/test", nil, &resp)
	if err != nil {
		t.Fatal(err)
	}
	if status == http.StatusOK {
		t.Fatalf("connection/test should fail when proxy is gone, got 200 (resp=%v)", resp)
	}
	errMsg, _ := resp["error"].(string)
	if !strings.Contains(errMsg, "resolve proxy") && !strings.Contains(errMsg, "requires bastion proxy") {
		t.Fatalf("expected fail-closed error, got status=%d msg=%q", status, errMsg)
	}
}

// randSuffix avoids name collisions when the test reruns against a DB that
// hasn't been wiped. Cheap monotonic counter via time-of-test would also
// work; this keeps the harness import-free.
var counter int

func randSuffix() int {
	counter++
	return counter*7919 + 1
}
