package cmdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"ops-platform/internal/security"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) ListAssets(ctx context.Context, assetType, env, query string) ([]Asset, error) {
	builder := strings.Builder{}
	builder.WriteString(`
SELECT id, type, name, status, env, source, COALESCE(external_id, ''), COALESCE(external_arn, ''), COALESCE(tags, '{}'::jsonb), created_at, updated_at
FROM cmdb_asset
WHERE deleted_at IS NULL`)

	args := make([]any, 0, 4)
	index := 1

	if assetType != "" {
		builder.WriteString(fmt.Sprintf(" AND type = $%d", index))
		args = append(args, assetType)
		index++
	}
	if env != "" {
		builder.WriteString(fmt.Sprintf(" AND env = $%d", index))
		args = append(args, env)
		index++
	}
	if query != "" {
		builder.WriteString(fmt.Sprintf(" AND (name ILIKE $%d OR external_id ILIKE $%d)", index, index))
		args = append(args, "%"+query+"%")
		index++
	}
	builder.WriteString(" ORDER BY updated_at DESC LIMIT 200")

	rows, err := r.db.QueryContext(ctx, builder.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assets []Asset
	for rows.Next() {
		var a Asset
		var rawTags []byte
		if err := rows.Scan(&a.ID, &a.Type, &a.Name, &a.Status, &a.Env, &a.Source, &a.ExternalID, &a.ExternalARN, &rawTags, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(rawTags, &a.Tags); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, rows.Err()
}

func (r *Repository) CreateAsset(ctx context.Context, req CreateAssetRequest) (Asset, error) {
	id := uuid.NewString()
	rawTags, err := json.Marshal(req.Tags)
	if err != nil {
		return Asset{}, err
	}

	var asset Asset
	var dbTags []byte
	query := `
INSERT INTO cmdb_asset (id, type, name, status, env, source, external_id, external_arn, tags)
VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), $9)
RETURNING id, type, name, status, env, source, COALESCE(external_id, ''), COALESCE(external_arn, ''), tags, created_at, updated_at`
	if err := r.db.QueryRowContext(ctx, query, id, req.Type, req.Name, req.Status, req.Env, req.Source, req.ExternalID, req.ExternalARN, rawTags).
		Scan(&asset.ID, &asset.Type, &asset.Name, &asset.Status, &asset.Env, &asset.Source, &asset.ExternalID, &asset.ExternalARN, &dbTags, &asset.CreatedAt, &asset.UpdatedAt); err != nil {
		return Asset{}, err
	}
	if err := json.Unmarshal(dbTags, &asset.Tags); err != nil {
		return Asset{}, err
	}

	return asset, nil
}

func (r *Repository) GetAsset(ctx context.Context, id string) (Asset, error) {
	var asset Asset
	var rawTags []byte

	query := `
SELECT id, type, name, status, env, source, COALESCE(external_id, ''), COALESCE(external_arn, ''), COALESCE(tags, '{}'::jsonb), created_at, updated_at
FROM cmdb_asset
WHERE id = $1 AND deleted_at IS NULL`
	if err := r.db.QueryRowContext(ctx, query, id).
		Scan(&asset.ID, &asset.Type, &asset.Name, &asset.Status, &asset.Env, &asset.Source, &asset.ExternalID, &asset.ExternalARN, &rawTags, &asset.CreatedAt, &asset.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Asset{}, ErrAssetNotFound
		}
		return Asset{}, err
	}
	if err := json.Unmarshal(rawTags, &asset.Tags); err != nil {
		return Asset{}, err
	}
	return asset, nil
}

func (r *Repository) UpdateAsset(ctx context.Context, id string, req UpdateAssetRequest) (Asset, error) {
	current, err := r.GetAsset(ctx, id)
	if err != nil {
		return Asset{}, err
	}

	if req.Name != nil {
		current.Name = *req.Name
	}
	if req.Status != nil {
		current.Status = *req.Status
	}
	if req.Env != nil {
		current.Env = *req.Env
	}
	if req.Tags != nil {
		current.Tags = req.Tags
	}

	rawTags, err := json.Marshal(current.Tags)
	if err != nil {
		return Asset{}, err
	}

	var updated Asset
	var dbTags []byte
	query := `
UPDATE cmdb_asset
SET name = $2, status = $3, env = $4, tags = $5, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, type, name, status, env, source, COALESCE(external_id, ''), COALESCE(external_arn, ''), tags, created_at, updated_at`
	if err := r.db.QueryRowContext(ctx, query, id, current.Name, current.Status, current.Env, rawTags).
		Scan(&updated.ID, &updated.Type, &updated.Name, &updated.Status, &updated.Env, &updated.Source, &updated.ExternalID, &updated.ExternalARN, &dbTags, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Asset{}, ErrAssetNotFound
		}
		return Asset{}, err
	}
	if err := json.Unmarshal(dbTags, &updated.Tags); err != nil {
		return Asset{}, err
	}
	return updated, nil
}

func (r *Repository) DeleteAsset(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, "UPDATE cmdb_asset SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", id)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return ErrAssetNotFound
	}
	return nil
}

var ErrAssetNotFound = errors.New("asset not found")
var ErrConnectionProfileNotFound = errors.New("asset connection profile not found")
var ErrProbeSnapshotNotFound = errors.New("asset probe snapshot not found")

func (r *Repository) GetAssetConnectionProfile(
	ctx context.Context,
	assetID string,
	includeSecrets bool,
	masterKey string,
) (AssetConnectionProfile, error) {
	if err := r.ensureAssetExists(ctx, assetID); err != nil {
		return AssetConnectionProfile{}, err
	}

	var profile AssetConnectionProfile
	var encryptedPassword string
	var encryptedPrivateKey string
	var encryptedPassphrase string
	err := r.db.QueryRowContext(ctx, `
SELECT
    asset_id::text,
    protocol,
    host,
    port,
    username,
    auth_type,
    bastion_enabled,
    COALESCE(password_encrypted, ''),
    COALESCE(private_key_encrypted, ''),
    COALESCE(passphrase_encrypted, ''),
    created_at,
    updated_at
FROM cmdb_asset_connection
WHERE asset_id = $1::uuid
`, assetID).Scan(
		&profile.AssetID,
		&profile.Protocol,
		&profile.Host,
		&profile.Port,
		&profile.Username,
		&profile.AuthType,
		&profile.BastionEnabled,
		&encryptedPassword,
		&encryptedPrivateKey,
		&encryptedPassphrase,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AssetConnectionProfile{}, ErrConnectionProfileNotFound
		}
		return AssetConnectionProfile{}, err
	}

	profile.HasPassword = strings.TrimSpace(encryptedPassword) != ""
	profile.HasPrivateKey = strings.TrimSpace(encryptedPrivateKey) != ""
	profile.HasPassphrase = strings.TrimSpace(encryptedPassphrase) != ""

	if includeSecrets {
		if encryptedPassword != "" {
			decrypted, err := security.Decrypt(encryptedPassword, masterKey)
			if err != nil {
				return AssetConnectionProfile{}, err
			}
			profile.Password = decrypted
		}
		if encryptedPrivateKey != "" {
			decrypted, err := security.Decrypt(encryptedPrivateKey, masterKey)
			if err != nil {
				return AssetConnectionProfile{}, err
			}
			profile.PrivateKey = decrypted
		}
		if encryptedPassphrase != "" {
			decrypted, err := security.Decrypt(encryptedPassphrase, masterKey)
			if err != nil {
				return AssetConnectionProfile{}, err
			}
			profile.Passphrase = decrypted
		}
	}

	return profile, nil
}

func (r *Repository) ResolveAssetConnectionProfile(
	ctx context.Context,
	assetID string,
	masterKey string,
) (AssetConnectionProfile, error) {
	return r.GetAssetConnectionProfile(ctx, assetID, true, masterKey)
}

func (r *Repository) UpsertAssetConnectionProfile(
	ctx context.Context,
	assetID string,
	req UpsertAssetConnectionProfileRequest,
	masterKey string,
) (AssetConnectionProfile, error) {
	if err := r.ensureAssetExists(ctx, assetID); err != nil {
		return AssetConnectionProfile{}, err
	}

	protocol := strings.ToLower(strings.TrimSpace(req.Protocol))
	if protocol == "" {
		protocol = "ssh"
	}
	host := strings.TrimSpace(req.Host)
	if host == "" {
		return AssetConnectionProfile{}, errors.New("host is required")
	}
	port := req.Port
	if port <= 0 {
		port = 22
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		return AssetConnectionProfile{}, errors.New("username is required")
	}
	authType := strings.ToLower(strings.TrimSpace(req.AuthType))
	if authType == "" {
		authType = "password"
	}
	if authType != "password" && authType != "key" {
		return AssetConnectionProfile{}, errors.New("auth_type must be password or key")
	}

	current, err := r.GetAssetConnectionProfile(ctx, assetID, true, masterKey)
	if err != nil && !errors.Is(err, ErrConnectionProfileNotFound) {
		return AssetConnectionProfile{}, err
	}

	password := current.Password
	if req.Password != nil {
		password = strings.TrimSpace(*req.Password)
	}
	privateKey := current.PrivateKey
	if req.PrivateKey != nil {
		privateKey = *req.PrivateKey
	}
	passphrase := current.Passphrase
	if req.Passphrase != nil {
		passphrase = *req.Passphrase
	}
	bastionEnabled := true
	if current.AssetID != "" {
		bastionEnabled = current.BastionEnabled
	}
	if req.BastionEnabled != nil {
		bastionEnabled = *req.BastionEnabled
	}

	encryptedPassword, err := security.Encrypt(password, masterKey)
	if err != nil {
		return AssetConnectionProfile{}, err
	}
	encryptedPrivateKey, err := security.Encrypt(privateKey, masterKey)
	if err != nil {
		return AssetConnectionProfile{}, err
	}
	encryptedPassphrase, err := security.Encrypt(passphrase, masterKey)
	if err != nil {
		return AssetConnectionProfile{}, err
	}

	_, err = r.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_connection (
    asset_id, protocol, host, port, username, auth_type, password_encrypted, private_key_encrypted, passphrase_encrypted, bastion_enabled
) VALUES (
    $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (asset_id) DO UPDATE SET
    protocol = EXCLUDED.protocol,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    auth_type = EXCLUDED.auth_type,
    password_encrypted = EXCLUDED.password_encrypted,
    private_key_encrypted = EXCLUDED.private_key_encrypted,
    passphrase_encrypted = EXCLUDED.passphrase_encrypted,
    bastion_enabled = EXCLUDED.bastion_enabled,
    updated_at = now()
`, assetID, protocol, host, port, username, authType, encryptedPassword, encryptedPrivateKey, encryptedPassphrase, bastionEnabled)
	if err != nil {
		return AssetConnectionProfile{}, err
	}

	return r.GetAssetConnectionProfile(ctx, assetID, false, masterKey)
}

func (r *Repository) UpsertAssetProbeSnapshot(
	ctx context.Context,
	assetID string,
	req UpsertAssetProbeSnapshotRequest,
) (AssetProbeSnapshot, error) {
	if err := r.ensureAssetExists(ctx, assetID); err != nil {
		return AssetProbeSnapshot{}, err
	}

	softwareRaw, err := json.Marshal(req.Software)
	if err != nil {
		return AssetProbeSnapshot{}, err
	}
	rawRaw, err := json.Marshal(req.Raw)
	if err != nil {
		return AssetProbeSnapshot{}, err
	}
	collectedBy := strings.TrimSpace(req.CollectedBy)
	if collectedBy == "" {
		collectedBy = "bastion-probe"
	}

	var snapshot AssetProbeSnapshot
	var dbSoftware []byte
	var dbRaw []byte
	err = r.db.QueryRowContext(ctx, `
INSERT INTO cmdb_asset_probe_snapshot (
    asset_id,
    os_name,
    os_version,
    kernel,
    arch,
    hostname,
    uptime_seconds,
    cpu_model,
    cpu_cores,
    memory_mb,
    disk_summary,
    software,
    raw_json,
    collected_by
) VALUES (
    $1::uuid,
    $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING id::text, asset_id::text, os_name, os_version, kernel, arch, hostname, uptime_seconds, cpu_model, cpu_cores, memory_mb, disk_summary, software, raw_json, collected_by, collected_at
`,
		assetID,
		strings.TrimSpace(req.OSName),
		strings.TrimSpace(req.OSVersion),
		strings.TrimSpace(req.Kernel),
		strings.TrimSpace(req.Arch),
		strings.TrimSpace(req.Hostname),
		req.UptimeSecond,
		strings.TrimSpace(req.CPUModel),
		req.CPUCores,
		req.MemoryMB,
		strings.TrimSpace(req.DiskSummary),
		softwareRaw,
		rawRaw,
		collectedBy,
	).Scan(
		&snapshot.ID,
		&snapshot.AssetID,
		&snapshot.OSName,
		&snapshot.OSVersion,
		&snapshot.Kernel,
		&snapshot.Arch,
		&snapshot.Hostname,
		&snapshot.UptimeSecond,
		&snapshot.CPUModel,
		&snapshot.CPUCores,
		&snapshot.MemoryMB,
		&snapshot.DiskSummary,
		&dbSoftware,
		&dbRaw,
		&snapshot.CollectedBy,
		&snapshot.CollectedAt,
	)
	if err != nil {
		return AssetProbeSnapshot{}, err
	}
	if err := json.Unmarshal(dbSoftware, &snapshot.Software); err != nil {
		return AssetProbeSnapshot{}, err
	}
	if err := json.Unmarshal(dbRaw, &snapshot.Raw); err != nil {
		return AssetProbeSnapshot{}, err
	}

	summaryRaw, err := json.Marshal(map[string]any{
		"os_name":        snapshot.OSName,
		"os_version":     snapshot.OSVersion,
		"kernel":         snapshot.Kernel,
		"arch":           snapshot.Arch,
		"hostname":       snapshot.Hostname,
		"cpu_model":      snapshot.CPUModel,
		"cpu_cores":      snapshot.CPUCores,
		"memory_mb":      snapshot.MemoryMB,
		"probe_at":       snapshot.CollectedAt,
		"probe_by":       snapshot.CollectedBy,
		"probe_software": snapshot.Software,
	})
	if err == nil {
		_, _ = r.db.ExecContext(ctx, `
UPDATE cmdb_asset
SET tags = COALESCE(tags, '{}'::jsonb) || $2::jsonb,
    updated_at = now()
WHERE id = $1::uuid
`, assetID, summaryRaw)
	}

	return snapshot, nil
}

func (r *Repository) GetLatestAssetProbeSnapshot(ctx context.Context, assetID string) (AssetProbeSnapshot, error) {
	if err := r.ensureAssetExists(ctx, assetID); err != nil {
		return AssetProbeSnapshot{}, err
	}

	var snapshot AssetProbeSnapshot
	var dbSoftware []byte
	var dbRaw []byte
	err := r.db.QueryRowContext(ctx, `
SELECT id::text, asset_id::text, os_name, os_version, kernel, arch, hostname, uptime_seconds, cpu_model, cpu_cores, memory_mb, disk_summary, software, raw_json, collected_by, collected_at
FROM cmdb_asset_probe_snapshot
WHERE asset_id = $1::uuid
ORDER BY collected_at DESC
LIMIT 1
`, assetID).Scan(
		&snapshot.ID,
		&snapshot.AssetID,
		&snapshot.OSName,
		&snapshot.OSVersion,
		&snapshot.Kernel,
		&snapshot.Arch,
		&snapshot.Hostname,
		&snapshot.UptimeSecond,
		&snapshot.CPUModel,
		&snapshot.CPUCores,
		&snapshot.MemoryMB,
		&snapshot.DiskSummary,
		&dbSoftware,
		&dbRaw,
		&snapshot.CollectedBy,
		&snapshot.CollectedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AssetProbeSnapshot{}, ErrProbeSnapshotNotFound
		}
		return AssetProbeSnapshot{}, err
	}
	if err := json.Unmarshal(dbSoftware, &snapshot.Software); err != nil {
		return AssetProbeSnapshot{}, err
	}
	if err := json.Unmarshal(dbRaw, &snapshot.Raw); err != nil {
		return AssetProbeSnapshot{}, err
	}
	return snapshot, nil
}

func (r *Repository) ensureAssetExists(ctx context.Context, assetID string) error {
	var exists bool
	err := r.db.QueryRowContext(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM cmdb_asset
    WHERE id = $1::uuid AND deleted_at IS NULL
)
`, assetID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrAssetNotFound
	}
	return nil
}

func (r *Repository) ListBastionProbeTargets(
	ctx context.Context,
	masterKey string,
	limit int,
) ([]BastionProbeTarget, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT
    a.id::text,
    a.name,
    a.type,
    a.env,
    c.protocol,
    c.host,
    c.port,
    c.username,
    c.auth_type,
    COALESCE(c.password_encrypted, ''),
    COALESCE(c.private_key_encrypted, ''),
    COALESCE(c.passphrase_encrypted, '')
FROM cmdb_asset_connection c
JOIN cmdb_asset a ON a.id = c.asset_id
WHERE a.deleted_at IS NULL
  AND c.bastion_enabled = true
ORDER BY a.updated_at DESC
LIMIT $1
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	targets := make([]BastionProbeTarget, 0, limit)
	for rows.Next() {
		var target BastionProbeTarget
		var encryptedPassword string
		var encryptedPrivateKey string
		var encryptedPassphrase string
		if err := rows.Scan(
			&target.AssetID,
			&target.AssetName,
			&target.AssetType,
			&target.AssetEnv,
			&target.Protocol,
			&target.Host,
			&target.Port,
			&target.Username,
			&target.AuthType,
			&encryptedPassword,
			&encryptedPrivateKey,
			&encryptedPassphrase,
		); err != nil {
			return nil, err
		}

		if encryptedPassword != "" {
			decrypted, err := security.Decrypt(encryptedPassword, masterKey)
			if err != nil {
				return nil, err
			}
			target.Password = decrypted
		}
		if encryptedPrivateKey != "" {
			decrypted, err := security.Decrypt(encryptedPrivateKey, masterKey)
			if err != nil {
				return nil, err
			}
			target.PrivateKey = decrypted
		}
		if encryptedPassphrase != "" {
			decrypted, err := security.Decrypt(encryptedPassphrase, masterKey)
			if err != nil {
				return nil, err
			}
			target.Passphrase = decrypted
		}

		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return targets, nil
}
