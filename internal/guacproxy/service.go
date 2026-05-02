package guacproxy

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"strings"

	"ops-platform/internal/bastionprobe"
)

// RDPResolver resolves an asset ID into the decrypted credentials, target
// address, and (when the asset is behind a VPC proxy) an open SSH client that
// can tunnel TCP to the target. bastionprobe.Service implements this.
type RDPResolver interface {
	ResolveAssetRDP(ctx context.Context, assetID string) (bastionprobe.RDPResolution, error)
}

type Service struct {
	guacdAddr     string
	advertiseHost string
	resolver      RDPResolver
	logger        *log.Logger
}

func NewService(guacdAddr, advertiseHost string, resolver RDPResolver) *Service {
	host := strings.TrimSpace(advertiseHost)
	if host == "" {
		if h, err := os.Hostname(); err == nil {
			host = h
		} else {
			host = "127.0.0.1"
		}
	}
	addr := strings.TrimSpace(guacdAddr)
	if addr == "" {
		addr = "127.0.0.1:4822"
	}
	return &Service{
		guacdAddr:     addr,
		advertiseHost: host,
		resolver:      resolver,
		logger:        log.New(log.Writer(), "guacproxy ", log.LstdFlags),
	}
}

// Session is an active RDP bridge: a net.Conn to guacd with an optional SSH
// tunnel alive behind it. Closing the Session tears down both.
type Session struct {
	Conn      net.Conn
	AssetID   string
	AssetName string
	Target    string
	forwarder *sshForwarder
}

// Close shuts down the guacd connection and any tunnel resources.
func (s *Session) Close() error {
	if s.Conn != nil {
		_ = s.Conn.Close()
	}
	if s.forwarder != nil {
		s.forwarder.close()
	}
	return nil
}

// Reader exposes the buffered reader on the underlying guacd connection so
// callers that parse the stream as Guacamole instructions share the same
// buffer that holds handshake-leftover bytes.
func (s *Session) Reader() *bufio.Reader {
	if bc, ok := s.Conn.(*bufferedConn); ok {
		return bc.Reader()
	}
	return bufio.NewReader(s.Conn)
}

// Write writes raw bytes to the guacd connection. Guacamole instructions sent
// from the browser pass straight through here.
func (s *Session) Write(p []byte) (int, error) { return s.Conn.Write(p) }

// OpenRDP resolves the asset, establishes (if needed) an SSH forwarder through
// its VPC proxy, and completes the Guacamole handshake with guacd. The
// returned Session wraps the byte-level bridge ready for WebSocket tunneling.
func (s *Service) OpenRDP(ctx context.Context, assetID string, overrides RDPParams) (*Session, error) {
	res, err := s.resolver.ResolveAssetRDP(ctx, assetID)
	if err != nil {
		return nil, err
	}

	params := overrides
	params.Username = firstNonEmpty(params.Username, res.Target.Username)
	params.Password = firstNonEmpty(params.Password, res.Target.Password)
	if params.Timezone == "" {
		params.Timezone = "UTC"
	}
	// Default performance flags — keep minimal to save bandwidth.
	// Callers can flip these in overrides.

	hostname, port, err := net.SplitHostPort(res.TargetAddr)
	if err != nil {
		return nil, fmt.Errorf("bad target addr %q: %w", res.TargetAddr, err)
	}
	params.Hostname = hostname
	if n, _ := parsePort(port); n > 0 {
		params.Port = n
	}

	var forwarder *sshForwarder
	if res.ProxyClient != nil {
		forwarder, err = newSSHForwarder(res.ProxyClient, res.TargetAddr, s.advertiseHost, s.logger)
		if err != nil {
			_ = res.ProxyClient.Close()
			return nil, fmt.Errorf("open ssh forwarder: %w", err)
		}
		fwdHost, fwdPortStr, _ := net.SplitHostPort(forwarder.advertiseAddr)
		params.Hostname = fwdHost
		if n, _ := parsePort(fwdPortStr); n > 0 {
			params.Port = n
		}
	}

	conn, err := DialRDP(ctx, s.guacdAddr, params)
	if err != nil {
		if forwarder != nil {
			forwarder.close()
		}
		return nil, err
	}

	s.logger.Printf("rdp session opened: asset=%s (%s) target=%s via=%s", res.Target.AssetID, res.Target.AssetName, res.TargetAddr, ternary(res.ProxyClient != nil, "proxy", "direct"))

	return &Session{
		Conn:      conn,
		AssetID:   res.Target.AssetID,
		AssetName: res.Target.AssetName,
		Target:    res.TargetAddr,
		forwarder: forwarder,
	}, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parsePort(s string) (int, error) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("invalid port %q", s)
		}
		n = n*10 + int(r-'0')
	}
	if n == 0 {
		return 0, fmt.Errorf("empty port")
	}
	return n, nil
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}
