package bastionprobe

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/ssh"

	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
	"ops-platform/internal/hostkey"
)

// KeyLookup resolves an SSH key by name (typically from EC2 KeyName) to the
// stored private key and passphrase. Used when an asset carries only the key
// name rather than per-asset credentials.
type KeyLookup interface {
	GetSecretsByName(ctx context.Context, name string) (privateKey, passphrase string, err error)
}

type Service struct {
	cfg      config.Config
	repo     *cmdb.Repository
	hostkeys *hostkey.Verifier
	keys     KeyLookup
	logger   *log.Logger
}

func NewService(cfg config.Config, repo *cmdb.Repository, hostkeys *hostkey.Verifier, keys KeyLookup) *Service {
	return &Service{
		cfg:      cfg,
		repo:     repo,
		hostkeys: hostkeys,
		keys:     keys,
		logger:   log.New(log.Writer(), "bastion-probe ", log.LstdFlags),
	}
}

func (s *Service) RunLoop(ctx context.Context) {
	if s.cfg.ProbeRunOnStart {
		if err := s.RunOnce(ctx); err != nil {
			s.logger.Printf("initial probe failed: %v", err)
		}
	}

	ticker := time.NewTicker(s.cfg.ProbeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Printf("probe loop stopped")
			return
		case <-ticker.C:
			if err := s.RunOnce(ctx); err != nil {
				s.logger.Printf("scheduled probe failed: %v", err)
			}
		}
	}
}

func (s *Service) RunOnce(ctx context.Context) error {
	targets, err := s.repo.ListBastionProbeTargets(ctx, s.cfg.MasterKey, s.cfg.ProbeBatchSize)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		s.logger.Printf("no bastion-enabled targets found")
		return nil
	}

	var processed int64
	sem := make(chan struct{}, s.cfg.ProbeConcurrency)
	errCh := make(chan error, len(targets))
	wg := sync.WaitGroup{}

	for _, target := range targets {
		target := target
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			probeCtx, cancel := context.WithTimeout(ctx, s.cfg.ProbeTimeout)
			defer cancel()

			if _, err := s.probeTarget(probeCtx, target); err != nil {
				errCh <- fmt.Errorf("asset=%s host=%s: %w", target.AssetID, target.Host, err)
				return
			}
			atomic.AddInt64(&processed, 1)
		}()
	}

	wg.Wait()
	close(errCh)

	var joined error
	for item := range errCh {
		joined = errors.Join(joined, item)
	}

	s.logger.Printf("probe run done: total=%d success=%d failed=%d", len(targets), processed, len(targets)-int(processed))
	return joined
}

// DialAssetSSH opens an SSH client to the given asset, going through the
// configured proxy when set. Caller owns closing the client.
func (s *Service) DialAssetSSH(ctx context.Context, assetID string) (*ssh.Client, error) {
	target, err := s.repo.GetBastionProbeTarget(ctx, assetID, s.cfg.MasterKey)
	if err != nil {
		return nil, err
	}
	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	if protocol != "" && protocol != "ssh" {
		return nil, fmt.Errorf("asset protocol is %q, terminal requires ssh", target.Protocol)
	}
	return s.dialSSH(ctx, target, s.cfg.ProbeTimeout)
}

// ProbeAsset runs a single probe for a specific asset synchronously and returns
// the resulting snapshot. The snapshot is persisted and connection probe status
// is updated.
func (s *Service) ProbeAsset(ctx context.Context, assetID string) (cmdb.AssetProbeSnapshot, error) {
	target, err := s.repo.GetBastionProbeTarget(ctx, assetID, s.cfg.MasterKey)
	if err != nil {
		return cmdb.AssetProbeSnapshot{}, err
	}
	probeCtx, cancel := context.WithTimeout(ctx, s.cfg.ProbeTimeout)
	defer cancel()
	return s.probeTarget(probeCtx, target)
}

// TestConnection performs a minimal handshake/ping without writing a probe
// snapshot. It updates probe status so operators can see the last test result.
func (s *Service) TestConnection(ctx context.Context, assetID string) error {
	target, err := s.repo.GetBastionProbeTarget(ctx, assetID, s.cfg.MasterKey)
	if err != nil {
		return err
	}
	testCtx, cancel := context.WithTimeout(ctx, s.cfg.ProbeTimeout)
	defer cancel()

	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	switch protocol {
	case "", "ssh":
		client, dialErr := s.dialSSH(testCtx, target, s.cfg.ProbeTimeout)
		if dialErr != nil {
			_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "failed", dialErr.Error())
			return dialErr
		}
		defer client.Close()

		out, execErr := runSSHCommand(client, "echo ok")
		if execErr != nil {
			_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "failed", execErr.Error())
			return execErr
		}
		if strings.TrimSpace(out) != "ok" {
			msg := "unexpected echo output: " + strings.TrimSpace(out)
			_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "failed", msg)
			return errors.New(msg)
		}
	case "postgres":
		conn, pingErr := s.dialPostgres(testCtx, target, s.cfg.ProbeTimeout)
		if pingErr != nil {
			_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "failed", pingErr.Error())
			return pingErr
		}
		_ = conn.Close(ctx)
	default:
		msg := "unsupported protocol: " + target.Protocol
		_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "failed", msg)
		return errors.New(msg)
	}

	_ = s.repo.UpdateConnectionProbeStatus(ctx, assetID, "success", "")
	return nil
}

func (s *Service) probeTarget(ctx context.Context, target cmdb.BastionProbeTarget) (cmdb.AssetProbeSnapshot, error) {
	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	var snapshot collectedSnapshot
	var err error
	switch protocol {
	case "", "ssh":
		snapshot, err = s.collectSnapshot(ctx, target)
	case "postgres":
		snapshot, err = s.collectPostgresSnapshot(ctx, target)
	default:
		err = fmt.Errorf("unsupported protocol: %s", target.Protocol)
	}
	if err != nil {
		_ = s.repo.UpdateConnectionProbeStatus(ctx, target.AssetID, "failed", err.Error())
		return cmdb.AssetProbeSnapshot{}, err
	}

	persisted, err := s.repo.UpsertAssetProbeSnapshot(ctx, target.AssetID, cmdb.UpsertAssetProbeSnapshotRequest{
		OSName:       snapshot.osName,
		OSVersion:    snapshot.osVersion,
		Kernel:       snapshot.kernel,
		Arch:         snapshot.arch,
		Hostname:     snapshot.hostname,
		UptimeSecond: snapshot.uptimeSecond,
		CPUModel:     snapshot.cpuModel,
		CPUCores:     snapshot.cpuCores,
		MemoryMB:     snapshot.memoryMB,
		DiskSummary:  snapshot.diskSummary,
		Software:     snapshot.software,
		Raw:          snapshot.raw,
		CollectedBy:  "bastion-probe-v1",
	})
	if err != nil {
		_ = s.repo.UpdateConnectionProbeStatus(ctx, target.AssetID, "failed", err.Error())
		return cmdb.AssetProbeSnapshot{}, err
	}

	_ = s.repo.UpdateConnectionProbeStatus(ctx, target.AssetID, "success", "")

	s.logger.Printf("probe success: asset=%s host=%s os=%s cpu=%d mem=%dMB", target.AssetID, target.Host, snapshot.osName, snapshot.cpuCores, snapshot.memoryMB)
	return persisted, nil
}

type collectedSnapshot struct {
	osName       string
	osVersion    string
	kernel       string
	arch         string
	hostname     string
	uptimeSecond int64
	cpuModel     string
	cpuCores     int
	memoryMB     int
	diskSummary  string
	software     []string
	raw          map[string]any
}

func (s *Service) collectSnapshot(ctx context.Context, target cmdb.BastionProbeTarget) (collectedSnapshot, error) {
	client, err := s.dialSSH(ctx, target, s.cfg.ProbeTimeout)
	if err != nil {
		return collectedSnapshot{}, err
	}
	defer client.Close()

	if err := ctx.Err(); err != nil {
		return collectedSnapshot{}, err
	}

	snapshot := collectedSnapshot{raw: make(map[string]any)}

	run := func(key string, command string) string {
		out, err := runSSHCommand(client, command)
		if err != nil {
			snapshot.raw[key+"_error"] = err.Error()
			return ""
		}
		snapshot.raw[key] = out
		return strings.TrimSpace(out)
	}

	snapshot.osName = run("os_name", "uname -s")
	snapshot.kernel = run("kernel", "uname -r")
	snapshot.arch = run("arch", "uname -m")
	snapshot.osVersion = run("os_version", "sh -c 'cat /etc/os-release 2>/dev/null | sed -n \"s/^PRETTY_NAME=//p\" | tr -d \"\\\"\" | head -n1'")
	snapshot.hostname = run("hostname", "hostname")
	snapshot.uptimeSecond = parseInt64(run("uptime_seconds", "sh -c 'cat /proc/uptime 2>/dev/null | awk \"{print int($1)}\" || echo 0'"))
	snapshot.cpuModel = run("cpu_model", "sh -c 'awk -F: \"/model name/{print $2; exit}\" /proc/cpuinfo 2>/dev/null | xargs'")
	snapshot.cpuCores = parseInt(run("cpu_cores", "sh -c 'nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0'"))
	snapshot.memoryMB = parseInt(run("memory_mb", "sh -c 'awk \"/MemTotal/{print int($2/1024)}\" /proc/meminfo 2>/dev/null || echo 0'"))
	snapshot.diskSummary = run("disk_summary", "sh -c 'df -h --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2 | head -n 10'")
	softwareRaw := run("software", "sh -c \"if command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f='${Package}\\\\n' | head -n 40; elif command -v rpm >/dev/null 2>&1; then rpm -qa | head -n 40; else echo ''; fi\"")
	snapshot.software = splitLines(softwareRaw)

	if snapshot.osName == "" {
		snapshot.osName = "unknown"
	}
	return snapshot, nil
}

// dialSSH dials the target. If target.Proxy is set it first dials the proxy
// and tunnels TCP to the destination through the proxy SSH session, forming a
// jump chain. Host keys are pinned via the hostkey verifier on both hops.
func (s *Service) dialSSH(ctx context.Context, target cmdb.BastionProbeTarget, timeout time.Duration) (*ssh.Client, error) {
	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	if protocol == "" {
		protocol = "ssh"
	}
	if protocol != "ssh" {
		return nil, fmt.Errorf("unsupported protocol for ssh dial: %s", target.Protocol)
	}

	if err := s.resolveKeyCredentials(ctx, &target); err != nil {
		return nil, err
	}

	auth, err := buildSSHAuth(target.AuthType, target.Password, target.PrivateKey, target.Passphrase)
	if err != nil {
		return nil, err
	}
	sshCfg := &ssh.ClientConfig{
		User:            target.Username,
		Auth:            auth,
		HostKeyCallback: s.hostkeys.Callback(hostkey.ScopeAsset, target.AssetID),
		Timeout:         timeout,
	}
	addr := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))

	if target.Proxy == nil {
		return ssh.Dial("tcp", addr, sshCfg)
	}

	proxyClient, err := s.dialProxy(target.Proxy, timeout)
	if err != nil {
		return nil, fmt.Errorf("proxy dial: %w", err)
	}
	conn, err := proxyClient.Dial("tcp", addr)
	if err != nil {
		proxyClient.Close()
		return nil, fmt.Errorf("proxy tunnel to %s: %w", addr, err)
	}
	clientConn, chans, reqs, err := ssh.NewClientConn(conn, addr, sshCfg)
	if err != nil {
		proxyClient.Close()
		return nil, err
	}
	client := ssh.NewClient(clientConn, chans, reqs)
	// close proxy when target client closes
	go func() {
		client.Wait()
		proxyClient.Close()
	}()
	return client, nil
}

func (s *Service) dialProxy(p *cmdb.SSHProxyTarget, timeout time.Duration) (*ssh.Client, error) {
	auth, err := buildSSHAuth(p.AuthType, p.Password, p.PrivateKey, p.Passphrase)
	if err != nil {
		return nil, err
	}
	cfg := &ssh.ClientConfig{
		User:            p.Username,
		Auth:            auth,
		HostKeyCallback: s.hostkeys.Callback(hostkey.ScopeProxy, p.ID),
		Timeout:         timeout,
	}
	port := p.Port
	if port <= 0 {
		port = 22
	}
	addr := net.JoinHostPort(p.Host, strconv.Itoa(port))
	return ssh.Dial("tcp", addr, cfg)
}

// resolveKeyCredentials fills in PrivateKey/Passphrase from the named keypair
// store when the target is key-auth but carries no per-asset credentials (e.g.
// EC2 instances synced with only KeyName). No-op otherwise.
func (s *Service) resolveKeyCredentials(ctx context.Context, target *cmdb.BastionProbeTarget) error {
	authType := strings.ToLower(strings.TrimSpace(target.AuthType))
	if authType != "key" {
		return nil
	}
	if strings.TrimSpace(target.PrivateKey) != "" {
		return nil
	}
	name := strings.TrimSpace(target.KeyName)
	if name == "" {
		return nil
	}
	if s.keys == nil {
		return fmt.Errorf("asset references key %q but no keypair store is configured", name)
	}
	pk, pass, err := s.keys.GetSecretsByName(ctx, name)
	if err != nil {
		return fmt.Errorf("lookup keypair %q: %w", name, err)
	}
	target.PrivateKey = pk
	if strings.TrimSpace(target.Passphrase) == "" {
		target.Passphrase = pass
	}
	return nil
}

func buildSSHAuth(authType, password, privateKey, passphrase string) ([]ssh.AuthMethod, error) {
	authType = strings.ToLower(strings.TrimSpace(authType))
	if authType == "" {
		authType = "password"
	}

	auth := make([]ssh.AuthMethod, 0, 2)
	switch authType {
	case "password":
		if strings.TrimSpace(password) == "" {
			return nil, errors.New("password auth but password is empty")
		}
		auth = append(auth, ssh.Password(password))
	case "key":
		if strings.TrimSpace(privateKey) == "" {
			return nil, errors.New("key auth but private_key is empty")
		}
		var signer ssh.Signer
		var err error
		if strings.TrimSpace(passphrase) == "" {
			signer, err = ssh.ParsePrivateKey([]byte(privateKey))
		} else {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
		}
		if err != nil {
			return nil, err
		}
		auth = append(auth, ssh.PublicKeys(signer))
	default:
		return nil, fmt.Errorf("unsupported auth_type: %s", authType)
	}

	return auth, nil
}

func runSSHCommand(client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return "", fmt.Errorf("command failed: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func parseInt(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	if value < 0 {
		return 0
	}
	return value
}

func parseInt64(raw string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0
	}
	if value < 0 {
		return 0
	}
	return value
}

func splitLines(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	items := strings.Split(raw, "\n")
	result := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

// dialPostgres connects to a PostgreSQL target. When target.Proxy is set the
// TCP connection is tunnelled through the SSH proxy so operators can reach DBs
// in isolated network zones.
func (s *Service) dialPostgres(ctx context.Context, target cmdb.BastionProbeTarget, timeout time.Duration) (*pgx.Conn, error) {
	host := target.Host
	port := target.Port
	if port <= 0 {
		port = 5432
	}
	database := strings.TrimSpace(target.Database)
	if database == "" {
		database = "postgres"
	}
	cfg, err := pgx.ParseConfig("postgres://")
	if err != nil {
		return nil, err
	}
	cfg.Host = host
	cfg.Port = uint16(port)
	cfg.User = target.Username
	cfg.Password = target.Password
	cfg.Database = database
	cfg.ConnectTimeout = timeout
	// disable TLS for now (v1); many internal DBs don't present a cert
	cfg.TLSConfig = nil

	if target.Proxy != nil {
		proxyClient, err := s.dialProxy(target.Proxy, timeout)
		if err != nil {
			return nil, fmt.Errorf("proxy dial: %w", err)
		}
		cfg.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, err := proxyClient.Dial(network, addr)
			if err != nil {
				return nil, err
			}
			return conn, nil
		}
	}

	connCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return pgx.ConnectConfig(connCtx, cfg)
}

func (s *Service) collectPostgresSnapshot(ctx context.Context, target cmdb.BastionProbeTarget) (collectedSnapshot, error) {
	conn, err := s.dialPostgres(ctx, target, s.cfg.ProbeTimeout)
	if err != nil {
		return collectedSnapshot{}, err
	}
	defer conn.Close(ctx)

	snapshot := collectedSnapshot{raw: make(map[string]any), osName: "postgres"}

	scalar := func(key, query string) string {
		var out string
		if err := conn.QueryRow(ctx, query).Scan(&out); err != nil {
			snapshot.raw[key+"_error"] = err.Error()
			return ""
		}
		snapshot.raw[key] = out
		return out
	}

	version := scalar("version", "SELECT version()")
	snapshot.osVersion = version
	snapshot.kernel = scalar("server_version", "SHOW server_version")
	snapshot.hostname = target.Host
	snapshot.arch = scalar("server_encoding", "SHOW server_encoding")

	var dbSize, currentDB, connCount string
	if err := conn.QueryRow(ctx, "SELECT current_database()").Scan(&currentDB); err == nil {
		snapshot.raw["current_database"] = currentDB
	}
	if err := conn.QueryRow(ctx, "SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&dbSize); err == nil {
		snapshot.raw["database_size"] = dbSize
	}
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity").Scan(&connCount); err == nil {
		snapshot.raw["connection_count"] = connCount
	}

	var maxConn string
	if err := conn.QueryRow(ctx, "SHOW max_connections").Scan(&maxConn); err == nil {
		snapshot.raw["max_connections"] = maxConn
	}
	var uptime int64
	if err := conn.QueryRow(ctx, "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint").Scan(&uptime); err == nil {
		snapshot.uptimeSecond = uptime
	}

	snapshot.diskSummary = fmt.Sprintf("database=%s size=%s connections=%s/%s", currentDB, dbSize, connCount, maxConn)
	snapshot.cpuModel = "n/a (postgres)"
	return snapshot, nil
}
