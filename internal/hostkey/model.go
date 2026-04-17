package hostkey

import "time"

const (
	ScopeAsset = "asset"
	ScopeProxy = "proxy"
)

type Record struct {
	ID                      string     `json:"id"`
	Scope                   string     `json:"scope"`
	TargetID                string     `json:"target_id"`
	TargetName              string     `json:"target_name,omitempty"`
	Host                    string     `json:"host"`
	Port                    int        `json:"port"`
	KeyType                 string     `json:"key_type"`
	FingerprintSHA256       string     `json:"fingerprint_sha256"`
	Status                  string     `json:"status"`
	FirstSeenAt             time.Time  `json:"first_seen_at"`
	LastSeenAt              time.Time  `json:"last_seen_at"`
	OverrideBy              string     `json:"override_by,omitempty"`
	OverrideAt              *time.Time `json:"override_at,omitempty"`
	OverrideExpiresAt       *time.Time `json:"override_expires_at,omitempty"`
	LastMismatchAt          *time.Time `json:"last_mismatch_at,omitempty"`
	LastMismatchFingerprint string     `json:"last_mismatch_fingerprint,omitempty"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
}
