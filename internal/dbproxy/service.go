// Package dbproxy is the L1 database access broker: it brokers a controlled,
// audited raw-TCP link to a MySQL/PostgreSQL/Redis asset (through the asset's
// VPC proxy when present) and tunnels it over a WebSocket so a thin local
// helper can expose it to the operator's own client. It deliberately does
// NOT parse the DB wire protocol — no query capture, SQL filtering, web
// console or recording (those are PAM pillars, out of scope; see
// docs/design/db-session-broker-spec.md).
package dbproxy

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"ops-platform/internal/bastionprobe"
)

// Resolver resolves an asset ID into a database target address plus, when
// the asset is behind a VPC proxy, an open SSH client to tunnel TCP through.
// bastionprobe.Service implements this via ResolveAssetDB.
type Resolver interface {
	ResolveAssetDB(ctx context.Context, assetID string) (bastionprobe.RDPResolution, error)
}

type Service struct {
	resolver Resolver
	logger   *log.Logger
}

func NewService(resolver Resolver) *Service {
	return &Service{
		resolver: resolver,
		logger:   log.New(log.Writer(), "dbproxy ", log.LstdFlags),
	}
}

// closer is the subset of *ssh.Client the proxy lifetime needs; kept as an
// interface so this package doesn't import golang.org/x/crypto/ssh.
type closer interface{ Close() error }

// Conn is an open raw-TCP connection to the database. Closing it also tears
// down the VPC-proxy SSH client when one was used.
type Conn struct {
	net.Conn
	AssetID   string
	AssetName string
	Protocol  string
	Target    string
	proxy     closer
}

func (c *Conn) Close() error {
	if c.Conn != nil {
		_ = c.Conn.Close()
	}
	if c.proxy != nil {
		_ = c.proxy.Close()
	}
	return nil
}

// Open resolves the asset and dials the database — through the asset's VPC
// proxy SSH client when present, otherwise directly. The returned Conn is a
// raw byte pipe; the wire protocol is never inspected.
func (s *Service) Open(ctx context.Context, assetID string) (*Conn, error) {
	res, err := s.resolver.ResolveAssetDB(ctx, assetID)
	if err != nil {
		return nil, err
	}

	c := &Conn{
		AssetID:   res.Target.AssetID,
		AssetName: res.Target.AssetName,
		Protocol:  res.Protocol,
		Target:    res.TargetAddr,
	}

	if res.ProxyClient != nil {
		raw, derr := res.ProxyClient.Dial("tcp", res.TargetAddr)
		if derr != nil {
			_ = res.ProxyClient.Close()
			return nil, fmt.Errorf("proxy dial db: %w", derr)
		}
		c.Conn = raw
		c.proxy = res.ProxyClient
		s.logger.Printf("db session opened: asset=%s (%s) target=%s via=proxy", res.Target.AssetID, res.Target.AssetName, res.TargetAddr)
		return c, nil
	}

	d := net.Dialer{Timeout: 10 * time.Second}
	raw, derr := d.DialContext(ctx, "tcp", res.TargetAddr)
	if derr != nil {
		return nil, fmt.Errorf("dial db: %w", derr)
	}
	c.Conn = raw
	s.logger.Printf("db session opened: asset=%s (%s) target=%s via=direct", res.Target.AssetID, res.Target.AssetName, res.TargetAddr)
	return c, nil
}
