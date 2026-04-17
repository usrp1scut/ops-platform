package hostkey

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net"
	"strconv"
	"time"

	"golang.org/x/crypto/ssh"
)

// OverrideTTL is how long an admin-approved override remains valid before
// auto-expiring if unused.
const OverrideTTL = 10 * time.Minute

type Verifier struct {
	repo   *Repository
	logger *log.Logger
}

func NewVerifier(repo *Repository) *Verifier {
	return &Verifier{repo: repo, logger: log.New(log.Writer(), "hostkey ", log.LstdFlags)}
}

// Fingerprint returns the SHA256 fingerprint string of an SSH public key in the
// format "SHA256:<base64>" (same format OpenSSH displays).
func Fingerprint(key ssh.PublicKey) string {
	sum := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(sum[:])
}

// Callback returns an ssh.HostKeyCallback that enforces TOFU pinning for the
// given (scope, targetID) tuple. Behavior:
//   - no record yet → record the offered key (silent TOFU), accept
//   - record exists, fingerprint matches → touch last_seen_at, accept
//   - record exists, mismatch, no valid override → stamp mismatch, reject
//   - record exists, mismatch, override_pending and not expired → replace pin, accept
func (v *Verifier) Callback(scope, targetID string) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := Fingerprint(key)
		keyType := key.Type()
		host, portStr, _ := net.SplitHostPort(hostname)
		if host == "" {
			host = hostname
		}
		port, _ := strconv.Atoi(portStr)
		if port == 0 {
			port = 22
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, _, err := v.repo.Upsert(ctx, scope, targetID, host, port, keyType, fp)
		if err != nil {
			return fmt.Errorf("hostkey upsert: %w", err)
		}
		// Re-read to determine pin state.
		existing, err := v.repo.Get(ctx, scope, targetID)
		if err != nil {
			return fmt.Errorf("hostkey lookup: %w", err)
		}
		if existing.FingerprintSHA256 == fp {
			// matches (either just-inserted TOFU, or existing pin)
			return nil
		}
		// mismatch — check for active override
		consumed, cErr := v.repo.ConsumeOverride(ctx, scope, targetID, keyType, fp)
		if cErr != nil {
			return fmt.Errorf("hostkey override check: %w", cErr)
		}
		if consumed {
			v.logger.Printf("override consumed scope=%s target=%s old=%s new=%s by=%s",
				scope, targetID, existing.FingerprintSHA256, fp, existing.OverrideBy)
			return nil
		}
		_ = v.repo.RecordMismatch(ctx, scope, targetID, fp)
		v.logger.Printf("HOST KEY MISMATCH scope=%s target=%s host=%s pinned=%s offered=%s",
			scope, targetID, host, existing.FingerprintSHA256, fp)
		return errors.New("ssh host key mismatch — pinned fingerprint " + existing.FingerprintSHA256 +
			" does not match offered " + fp + "; ask an admin to approve a one-time override if the server was legitimately re-keyed")
	}
}
