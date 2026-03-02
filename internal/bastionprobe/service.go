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

	"golang.org/x/crypto/ssh"

	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
)

type Service struct {
	cfg    config.Config
	repo   *cmdb.Repository
	logger *log.Logger
}

func NewService(cfg config.Config, repo *cmdb.Repository) *Service {
	return &Service{
		cfg:    cfg,
		repo:   repo,
		logger: log.New(log.Writer(), "bastion-probe ", log.LstdFlags),
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

			if err := s.probeTarget(probeCtx, target); err != nil {
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

func (s *Service) probeTarget(ctx context.Context, target cmdb.BastionProbeTarget) error {
	snapshot, err := s.collectSnapshot(ctx, target)
	if err != nil {
		return err
	}

	_, err = s.repo.UpsertAssetProbeSnapshot(ctx, target.AssetID, cmdb.UpsertAssetProbeSnapshotRequest{
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
		return err
	}

	s.logger.Printf("probe success: asset=%s host=%s os=%s cpu=%d mem=%dMB", target.AssetID, target.Host, snapshot.osName, snapshot.cpuCores, snapshot.memoryMB)
	return nil
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
	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	if protocol == "" {
		protocol = "ssh"
	}
	if protocol != "ssh" {
		return collectedSnapshot{}, fmt.Errorf("unsupported protocol: %s", target.Protocol)
	}

	auth, err := buildSSHAuth(target)
	if err != nil {
		return collectedSnapshot{}, err
	}

	sshCfg := &ssh.ClientConfig{
		User:            target.Username,
		Auth:            auth,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // v1: accept host key, harden with known_hosts later
		Timeout:         s.cfg.ProbeTimeout,
	}
	addr := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))

	client, err := ssh.Dial("tcp", addr, sshCfg)
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

func buildSSHAuth(target cmdb.BastionProbeTarget) ([]ssh.AuthMethod, error) {
	authType := strings.ToLower(strings.TrimSpace(target.AuthType))
	if authType == "" {
		authType = "password"
	}

	auth := make([]ssh.AuthMethod, 0, 2)
	switch authType {
	case "password":
		if strings.TrimSpace(target.Password) == "" {
			return nil, errors.New("password auth but password is empty")
		}
		auth = append(auth, ssh.Password(target.Password))
	case "key":
		if strings.TrimSpace(target.PrivateKey) == "" {
			return nil, errors.New("key auth but private_key is empty")
		}
		var signer ssh.Signer
		var err error
		if strings.TrimSpace(target.Passphrase) == "" {
			signer, err = ssh.ParsePrivateKey([]byte(target.PrivateKey))
		} else {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(target.PrivateKey), []byte(target.Passphrase))
		}
		if err != nil {
			return nil, err
		}
		auth = append(auth, ssh.PublicKeys(signer))
	default:
		return nil, fmt.Errorf("unsupported auth_type: %s", target.AuthType)
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
