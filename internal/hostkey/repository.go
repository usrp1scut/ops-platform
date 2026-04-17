package hostkey

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrNotFound = errors.New("host key not found")

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

const selectColumns = `
id::text, scope, target_id::text, host, port, key_type, fingerprint_sha256, status,
first_seen_at, last_seen_at,
COALESCE(override_by, ''), override_at, override_expires_at,
last_mismatch_at, COALESCE(last_mismatch_fingerprint, ''),
created_at, updated_at`

func scanRecord(row interface {
	Scan(dest ...any) error
}) (Record, error) {
	var r Record
	var overrideAt, overrideExp, lastMis sql.NullTime
	if err := row.Scan(
		&r.ID, &r.Scope, &r.TargetID, &r.Host, &r.Port, &r.KeyType, &r.FingerprintSHA256, &r.Status,
		&r.FirstSeenAt, &r.LastSeenAt,
		&r.OverrideBy, &overrideAt, &overrideExp,
		&lastMis, &r.LastMismatchFingerprint,
		&r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return Record{}, err
	}
	if overrideAt.Valid {
		t := overrideAt.Time
		r.OverrideAt = &t
	}
	if overrideExp.Valid {
		t := overrideExp.Time
		r.OverrideExpiresAt = &t
	}
	if lastMis.Valid {
		t := lastMis.Time
		r.LastMismatchAt = &t
	}
	return r, nil
}

func (r *Repository) Get(ctx context.Context, scope, targetID string) (Record, error) {
	row := r.db.QueryRowContext(ctx,
		"SELECT "+selectColumns+" FROM ssh_known_host WHERE scope = $1 AND target_id = $2::uuid",
		scope, targetID)
	rec, err := scanRecord(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, ErrNotFound
		}
		return Record{}, err
	}
	return rec, nil
}

// Upsert inserts a new TOFU record or updates last_seen_at when fingerprint matches.
// Returns the persisted record and whether it was newly created.
func (r *Repository) Upsert(ctx context.Context, scope, targetID, host string, port int, keyType, fingerprint string) (Record, bool, error) {
	row := r.db.QueryRowContext(ctx, `
INSERT INTO ssh_known_host (scope, target_id, host, port, key_type, fingerprint_sha256)
VALUES ($1, $2::uuid, $3, $4, $5, $6)
ON CONFLICT (scope, target_id) DO UPDATE
    SET last_seen_at = now(),
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        key_type = EXCLUDED.key_type,
        updated_at = now()
    WHERE ssh_known_host.fingerprint_sha256 = EXCLUDED.fingerprint_sha256
RETURNING `+selectColumns+`, (xmax = 0) AS inserted`,
		scope, targetID, host, port, keyType, fingerprint)
	var rec Record
	var overrideAt, overrideExp, lastMis sql.NullTime
	var inserted sql.NullBool
	if err := row.Scan(
		&rec.ID, &rec.Scope, &rec.TargetID, &rec.Host, &rec.Port, &rec.KeyType, &rec.FingerprintSHA256, &rec.Status,
		&rec.FirstSeenAt, &rec.LastSeenAt,
		&rec.OverrideBy, &overrideAt, &overrideExp,
		&lastMis, &rec.LastMismatchFingerprint,
		&rec.CreatedAt, &rec.UpdatedAt,
		&inserted,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// conflict but fingerprint didn't match → no row returned
			return Record{}, false, nil
		}
		return Record{}, false, err
	}
	if overrideAt.Valid {
		t := overrideAt.Time
		rec.OverrideAt = &t
	}
	if overrideExp.Valid {
		t := overrideExp.Time
		rec.OverrideExpiresAt = &t
	}
	if lastMis.Valid {
		t := lastMis.Time
		rec.LastMismatchAt = &t
	}
	return rec, inserted.Bool, nil
}

// RecordMismatch stamps last_mismatch info without changing the pinned fingerprint.
func (r *Repository) RecordMismatch(ctx context.Context, scope, targetID, offeredFingerprint string) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE ssh_known_host
   SET last_mismatch_at = now(),
       last_mismatch_fingerprint = $3,
       updated_at = now()
 WHERE scope = $1 AND target_id = $2::uuid`, scope, targetID, offeredFingerprint)
	return err
}

// ApproveOverride marks a record to accept the next non-matching fingerprint once.
// The override auto-expires after ttl.
func (r *Repository) ApproveOverride(ctx context.Context, scope, targetID, adminName string, ttl time.Duration) error {
	expires := time.Now().Add(ttl)
	result, err := r.db.ExecContext(ctx, `
UPDATE ssh_known_host
   SET status = 'override_pending',
       override_by = $3,
       override_at = now(),
       override_expires_at = $4,
       updated_at = now()
 WHERE scope = $1 AND target_id = $2::uuid`, scope, targetID, adminName, expires)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ConsumeOverride is called when the offered fingerprint does not match and an override
// is pending+unexpired: it rewrites the pinned fingerprint and clears override state.
// Returns true if the override was consumed.
func (r *Repository) ConsumeOverride(ctx context.Context, scope, targetID, keyType, fingerprint string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
UPDATE ssh_known_host
   SET fingerprint_sha256 = $4,
       key_type = $3,
       status = 'active',
       override_by = '',
       override_at = NULL,
       override_expires_at = NULL,
       last_mismatch_at = NULL,
       last_mismatch_fingerprint = '',
       first_seen_at = now(),
       last_seen_at = now(),
       updated_at = now()
 WHERE scope = $1 AND target_id = $2::uuid
   AND status = 'override_pending'
   AND override_expires_at IS NOT NULL
   AND override_expires_at > now()`, scope, targetID, keyType, fingerprint)
	if err != nil {
		return false, err
	}
	n, _ := result.RowsAffected()
	return n > 0, nil
}

func (r *Repository) Delete(ctx context.Context, scope, targetID string) error {
	result, err := r.db.ExecContext(ctx,
		"DELETE FROM ssh_known_host WHERE scope = $1 AND target_id = $2::uuid",
		scope, targetID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// List returns records joined with asset/proxy name for display.
func (r *Repository) List(ctx context.Context) ([]Record, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT `+selectColumns+`,
       COALESCE(
         CASE
           WHEN k.scope = 'asset' THEN (SELECT name FROM cmdb_asset WHERE id = k.target_id)
           WHEN k.scope = 'proxy' THEN (SELECT name FROM cmdb_ssh_proxy WHERE id = k.target_id)
         END, '') AS target_name
  FROM ssh_known_host k
 ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Record, 0)
	for rows.Next() {
		var r Record
		var overrideAt, overrideExp, lastMis sql.NullTime
		if err := rows.Scan(
			&r.ID, &r.Scope, &r.TargetID, &r.Host, &r.Port, &r.KeyType, &r.FingerprintSHA256, &r.Status,
			&r.FirstSeenAt, &r.LastSeenAt,
			&r.OverrideBy, &overrideAt, &overrideExp,
			&lastMis, &r.LastMismatchFingerprint,
			&r.CreatedAt, &r.UpdatedAt,
			&r.TargetName,
		); err != nil {
			return nil, err
		}
		if overrideAt.Valid {
			t := overrideAt.Time
			r.OverrideAt = &t
		}
		if overrideExp.Valid {
			t := overrideExp.Time
			r.OverrideExpiresAt = &t
		}
		if lastMis.Valid {
			t := lastMis.Time
			r.LastMismatchAt = &t
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
