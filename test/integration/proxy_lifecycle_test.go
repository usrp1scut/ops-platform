//go:build integration

package integration

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// End-to-end check for the P2 fix (see ADR-0006): when bastionprobe dials a
// PostgreSQL target through an SSH proxy, the proxy SSH session must be
// released after the probe completes. Pre-fix, dialPostgres returned only
// the pgx.Conn — the proxyClient leaked. Post-fix it returns a cleanup func
// that the caller defers.
//
// We assert this end-to-end by standing up a minimal in-process SSH server,
// pointing a real cmdb-proxy entry at it, and counting active sessions on the
// server side after running the probe several times. No container needed.
func TestProxyProbeReleasesSSHSession(t *testing.T) {
	srv := newFakeSSHServer(t, "ops", "secret")
	defer srv.close()

	h := Bootstrap(t)

	// Configure a proxy entry pointing at the fake sshd.
	proxyReq := map[string]any{
		"name":         fmt.Sprintf("integration-lifecycle-%d", randSuffix()),
		"network_zone": "test",
		"host":         srv.host,
		"port":         srv.port,
		"username":     "ops",
		"auth_type":    "password",
		"password":     "secret",
	}
	var proxy struct {
		ID string `json:"id"`
	}
	status, err := h.Do(http.MethodPost, "/api/v1/cmdb/ssh-proxies/", proxyReq, &proxy)
	if err != nil {
		t.Fatal(err)
	}
	if status/100 != 2 {
		t.Fatalf("create proxy status=%d", status)
	}

	// Asset with protocol=postgres. dialPostgres builds a tunnel through
	// our proxy, then pgx tries to speak postgres on the channel. The fake
	// SSH server accepts the direct-tcpip channel but closes it immediately,
	// so pgx returns an error. That's the path that previously leaked the
	// proxy SSH client; cleanup() must close it.
	assetReq := map[string]any{
		"type":   "manual",
		"name":   fmt.Sprintf("integration-lifecycle-asset-%d", randSuffix()),
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
	if status/100 != 2 {
		t.Fatalf("create asset status=%d", status)
	}

	t.Cleanup(func() {
		_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/assets/"+asset.ID, nil, nil)
		_, _ = h.Do(http.MethodDelete, "/api/v1/cmdb/ssh-proxies/"+proxy.ID, nil, nil)
	})

	connReq := map[string]any{
		"protocol":  "postgres",
		"host":      "127.0.0.1",
		"port":      5432,
		"username":  "u",
		"auth_type": "password",
		"password":  "p",
		"database":  "postgres",
		"proxy_id":  proxy.ID,
	}
	status, err = h.Do(http.MethodPut, "/api/v1/cmdb/assets/"+asset.ID+"/connection", connReq, nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK {
		t.Fatalf("upsert connection status=%d", status)
	}

	const probes = 4
	for i := 0; i < probes; i++ {
		// We expect a non-200 (postgres handshake fails through the
		// closing channel) — but the dial-side cleanup must still have run.
		var resp map[string]any
		_, _ = h.Do(http.MethodPost, "/api/v1/cmdb/assets/"+asset.ID+"/connection/test", nil, &resp)
	}

	// Wait for the fake sshd's handler goroutines to observe the SSH
	// disconnect. The server decrements its counter on handler return.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt64(&srv.active) == 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := atomic.LoadInt64(&srv.active); got != 0 {
		t.Fatalf("after %d probes, %d SSH sessions still active on the proxy — cleanup did not run", probes, got)
	}
	if got := atomic.LoadInt64(&srv.total); got < int64(probes) {
		t.Fatalf("expected at least %d SSH sessions across probes, saw %d (probes did not actually go through the proxy)", probes, got)
	}
}

// fakeSSHServer is the smallest viable sshd: ed25519 host key, password auth,
// and direct-tcpip channels that immediately close. Tracks session counts so
// the test can assert on cleanup behavior.
type fakeSSHServer struct {
	listener net.Listener
	host     string
	port     int

	active int64 // currently open sessions
	total  int64 // sessions opened over lifetime
}

func newFakeSSHServer(t *testing.T, user, password string) *fakeSSHServer {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	hostKey, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pw []byte) (*ssh.Permissions, error) {
			if c.User() == user && string(pw) == password {
				return &ssh.Permissions{}, nil
			}
			return nil, errors.New("denied")
		},
	}
	cfg.AddHostKey(hostKey)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	s := &fakeSSHServer{
		listener: ln,
		host:     addr.IP.String(),
		port:     addr.Port,
	}
	go s.serve(cfg)
	return s
}

func (s *fakeSSHServer) close() {
	_ = s.listener.Close()
}

func (s *fakeSSHServer) serve(cfg *ssh.ServerConfig) {
	for {
		c, err := s.listener.Accept()
		if err != nil {
			return
		}
		go s.handle(c, cfg)
	}
}

func (s *fakeSSHServer) handle(c net.Conn, cfg *ssh.ServerConfig) {
	defer c.Close()
	sc, chans, reqs, err := ssh.NewServerConn(c, cfg)
	if err != nil {
		return
	}
	atomic.AddInt64(&s.active, 1)
	atomic.AddInt64(&s.total, 1)
	defer atomic.AddInt64(&s.active, -1)
	defer sc.Close()
	go ssh.DiscardRequests(reqs)

	for newCh := range chans {
		switch newCh.ChannelType() {
		case "direct-tcpip":
			// Accept-and-close: dialPostgres' tunnel will see EOF on its
			// pgx handshake and error out — exactly the path we want to
			// exercise (the bug was: SSH client leaked even though the
			// pgx handshake had failed).
			ch, _, err := newCh.Accept()
			if err == nil {
				_ = ch.Close()
			}
		default:
			_ = newCh.Reject(ssh.UnknownChannelType, "unsupported")
		}
	}
}

