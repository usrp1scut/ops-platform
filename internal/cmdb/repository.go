package cmdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"ops-platform/internal/security"
)

const assetColumns = `
id,
type,
name,
status,
env,
source,
COALESCE(external_id, ''),
COALESCE(external_arn, ''),
COALESCE(public_ip, ''),
COALESCE(private_ip, ''),
COALESCE(private_dns, ''),
region,
zone,
account_id,
instance_type,
os_image,
vpc_id,
subnet_id,
COALESCE(key_name, ''),
owner,
business_unit,
criticality,
expires_at,
COALESCE(system_tags, '{}'::jsonb),
COALESCE(labels, '{}'::jsonb),
created_at,
updated_at`

func scanAsset(row interface {
	Scan(dest ...any) error
}) (Asset, error) {
	var a Asset
	var rawSystem []byte
	var rawLabels []byte
	var expires sql.NullTime
	if err := row.Scan(
		&a.ID,
		&a.Type,
		&a.Name,
		&a.Status,
		&a.Env,
		&a.Source,
		&a.ExternalID,
		&a.ExternalARN,
		&a.PublicIP,
		&a.PrivateIP,
		&a.PrivateDNS,
		&a.Region,
		&a.Zone,
		&a.AccountID,
		&a.InstanceType,
		&a.OSImage,
		&a.VPCID,
		&a.SubnetID,
		&a.KeyName,
		&a.Owner,
		&a.BusinessUnit,
		&a.Criticality,
		&expires,
		&rawSystem,
		&rawLabels,
		&a.CreatedAt,
		&a.UpdatedAt,
	); err != nil {
		return Asset{}, err
	}
	if expires.Valid {
		t := expires.Time
		a.ExpiresAt = &t
	}
	if err := json.Unmarshal(rawSystem, &a.SystemTags); err != nil {
		return Asset{}, err
	}
	if err := json.Unmarshal(rawLabels, &a.Labels); err != nil {
		return Asset{}, err
	}
	a.Tags = mergeTagMaps(a.SystemTags, a.Labels)
	return a, nil
}

func mergeTagMaps(system, labels map[string]any) map[string]any {
	if len(system) == 0 && len(labels) == 0 {
		return nil
	}
	out := make(map[string]any, len(system)+len(labels))
	for k, v := range system {
		out[k] = v
	}
	for k, v := range labels {
		out[k] = v
	}
	return out
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) ListAssets(ctx context.Context, q ListAssetsQuery) (ListAssetsResult, error) {
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}

	where := strings.Builder{}
	where.WriteString("deleted_at IS NULL")
	args := make([]any, 0, 10)
	index := 1

	addEq := func(column, value string) {
		if value == "" {
			return
		}
		where.WriteString(fmt.Sprintf(" AND %s = $%d", column, index))
		args = append(args, value)
		index++
	}
	addEq("type", q.Type)
	addEq("env", q.Env)
	addEq("status", q.Status)
	addEq("source", q.Source)
	addEq("region", q.Region)
	addEq("account_id", q.AccountID)
	addEq("owner", q.Owner)
	addEq("criticality", q.Criticality)

	if q.Query != "" {
		where.WriteString(fmt.Sprintf(
			" AND (name ILIKE $%d OR external_id ILIKE $%d OR public_ip ILIKE $%d OR private_ip ILIKE $%d OR private_dns ILIKE $%d OR region ILIKE $%d OR account_id ILIKE $%d OR owner ILIKE $%d)",
			index, index, index, index, index, index, index, index,
		))
		args = append(args, "%"+q.Query+"%")
		index++
	}

	var total int
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cmdb_asset WHERE "+where.String(), args...).Scan(&total); err != nil {
		return ListAssetsResult{}, err
	}

	listArgs := append(append([]any{}, args...), limit, offset)
	listSQL := fmt.Sprintf(
		"SELECT %s FROM cmdb_asset WHERE %s ORDER BY updated_at DESC LIMIT $%d OFFSET $%d",
		assetColumns, where.String(), index, index+1,
	)

	rows, err := r.db.QueryContext(ctx, listSQL, listArgs...)
	if err != nil {
		return ListAssetsResult{}, err
	}
	defer rows.Close()

	assets := make([]Asset, 0)
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return ListAssetsResult{}, err
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return ListAssetsResult{}, err
	}
	return ListAssetsResult{Items: assets, Total: total, Limit: limit, Offset: offset}, nil
}

func (r *Repository) CreateAsset(ctx context.Context, req CreateAssetRequest) (Asset, error) {
	id := uuid.NewString()
	labels := req.Labels
	if labels == nil {
		labels = req.Tags
	}
	if labels == nil {
		labels = map[string]any{}
	}
	rawLabels, err := json.Marshal(labels)
	if err != nil {
		return Asset{}, err
	}

	query := `
INSERT INTO cmdb_asset (
    id, type, name, status, env, source,
    external_id, external_arn,
    public_ip, private_ip, private_dns,
    region, zone, account_id, instance_type, os_image, vpc_id, subnet_id,
    owner, business_unit, criticality, expires_at,
    system_tags, labels
)
VALUES (
    $1, $2, $3, $4, $5, $6,
    NULLIF($7, ''), NULLIF($8, ''),
    $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18,
    $19, $20, $21, $22,
    '{}'::jsonb, $23
)
RETURNING ` + assetColumns
	row := r.db.QueryRowContext(
		ctx,
		query,
		id,
		req.Type,
		req.Name,
		req.Status,
		req.Env,
		req.Source,
		req.ExternalID,
		req.ExternalARN,
		strings.TrimSpace(req.PublicIP),
		strings.TrimSpace(req.PrivateIP),
		strings.TrimSpace(req.PrivateDNS),
		strings.TrimSpace(req.Region),
		strings.TrimSpace(req.Zone),
		strings.TrimSpace(req.AccountID),
		strings.TrimSpace(req.InstanceType),
		strings.TrimSpace(req.OSImage),
		strings.TrimSpace(req.VPCID),
		strings.TrimSpace(req.SubnetID),
		strings.TrimSpace(req.Owner),
		strings.TrimSpace(req.BusinessUnit),
		strings.TrimSpace(req.Criticality),
		nullTime(req.ExpiresAt),
		rawLabels,
	)
	return scanAsset(row)
}

func (r *Repository) GetAsset(ctx context.Context, id string) (Asset, error) {
	query := "SELECT " + assetColumns + " FROM cmdb_asset WHERE id = $1 AND deleted_at IS NULL"
	row := r.db.QueryRowContext(ctx, query, id)
	asset, err := scanAsset(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Asset{}, ErrAssetNotFound
		}
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
	if req.PublicIP != nil {
		current.PublicIP = *req.PublicIP
	}
	if req.PrivateIP != nil {
		current.PrivateIP = *req.PrivateIP
	}
	if req.PrivateDNS != nil {
		current.PrivateDNS = *req.PrivateDNS
	}
	if req.Region != nil {
		current.Region = *req.Region
	}
	if req.Zone != nil {
		current.Zone = *req.Zone
	}
	if req.AccountID != nil {
		current.AccountID = *req.AccountID
	}
	if req.InstanceType != nil {
		current.InstanceType = *req.InstanceType
	}
	if req.OSImage != nil {
		current.OSImage = *req.OSImage
	}
	if req.VPCID != nil {
		current.VPCID = *req.VPCID
	}
	if req.SubnetID != nil {
		current.SubnetID = *req.SubnetID
	}
	if req.Owner != nil {
		current.Owner = *req.Owner
	}
	if req.BusinessUnit != nil {
		current.BusinessUnit = *req.BusinessUnit
	}
	if req.Criticality != nil {
		current.Criticality = *req.Criticality
	}
	if req.ExpiresAt != nil {
		current.ExpiresAt = req.ExpiresAt
	}
	if req.Labels != nil {
		current.Labels = req.Labels
	}

	rawLabels, err := json.Marshal(current.Labels)
	if err != nil {
		return Asset{}, err
	}

	query := `
UPDATE cmdb_asset
SET name = $2, status = $3, env = $4,
    public_ip = $5, private_ip = $6, private_dns = $7,
    region = $8, zone = $9, account_id = $10,
    instance_type = $11, os_image = $12, vpc_id = $13, subnet_id = $14,
    owner = $15, business_unit = $16, criticality = $17, expires_at = $18,
    labels = $19,
    updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING ` + assetColumns
	row := r.db.QueryRowContext(
		ctx,
		query,
		id,
		current.Name,
		current.Status,
		current.Env,
		strings.TrimSpace(current.PublicIP),
		strings.TrimSpace(current.PrivateIP),
		strings.TrimSpace(current.PrivateDNS),
		strings.TrimSpace(current.Region),
		strings.TrimSpace(current.Zone),
		strings.TrimSpace(current.AccountID),
		strings.TrimSpace(current.InstanceType),
		strings.TrimSpace(current.OSImage),
		strings.TrimSpace(current.VPCID),
		strings.TrimSpace(current.SubnetID),
		strings.TrimSpace(current.Owner),
		strings.TrimSpace(current.BusinessUnit),
		strings.TrimSpace(current.Criticality),
		nullTime(current.ExpiresAt),
		rawLabels,
	)
	updated, err := scanAsset(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Asset{}, ErrAssetNotFound
		}
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
	var lastProbeAt sql.NullTime
	var proxyID sql.NullString
	var proxyName sql.NullString
	var proxyZone sql.NullString
	err := r.db.QueryRowContext(ctx, `
SELECT
    c.asset_id::text,
    c.protocol,
    c.host,
    c.port,
    c.username,
    c.auth_type,
    COALESCE(c.database_name, ''),
    c.bastion_enabled,
    c.proxy_id::text,
    p.name,
    p.network_zone,
    COALESCE(c.password_encrypted, ''),
    COALESCE(c.private_key_encrypted, ''),
    COALESCE(c.passphrase_encrypted, ''),
    c.last_probe_at,
    COALESCE(c.last_probe_status, ''),
    COALESCE(c.last_probe_error, ''),
    c.created_at,
    c.updated_at
FROM cmdb_asset_connection c
LEFT JOIN cmdb_ssh_proxy p ON p.id = c.proxy_id AND p.deleted_at IS NULL
WHERE c.asset_id = $1::uuid
`, assetID).Scan(
		&profile.AssetID,
		&profile.Protocol,
		&profile.Host,
		&profile.Port,
		&profile.Username,
		&profile.AuthType,
		&profile.Database,
		&profile.BastionEnabled,
		&proxyID,
		&proxyName,
		&proxyZone,
		&encryptedPassword,
		&encryptedPrivateKey,
		&encryptedPassphrase,
		&lastProbeAt,
		&profile.LastProbeStatus,
		&profile.LastProbeError,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AssetConnectionProfile{}, ErrConnectionProfileNotFound
		}
		return AssetConnectionProfile{}, err
	}
	if lastProbeAt.Valid {
		t := lastProbeAt.Time
		profile.LastProbeAt = &t
	}
	if proxyID.Valid {
		profile.ProxyID = proxyID.String
	}
	if proxyName.Valid {
		profile.ProxyName = proxyName.String
	}
	if proxyZone.Valid {
		profile.ProxyZone = proxyZone.String
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
	if protocol != "ssh" && protocol != "postgres" {
		return AssetConnectionProfile{}, errors.New("protocol must be ssh or postgres")
	}
	host := strings.TrimSpace(req.Host)
	if host == "" {
		return AssetConnectionProfile{}, errors.New("host is required")
	}
	port := req.Port
	if port <= 0 {
		if protocol == "postgres" {
			port = 5432
		} else {
			port = 22
		}
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		return AssetConnectionProfile{}, errors.New("username is required")
	}
	authType := strings.ToLower(strings.TrimSpace(req.AuthType))
	if authType == "" {
		authType = "password"
	}
	if protocol == "postgres" && authType != "password" {
		return AssetConnectionProfile{}, errors.New("postgres only supports password auth")
	}
	if authType != "password" && authType != "key" {
		return AssetConnectionProfile{}, errors.New("auth_type must be password or key")
	}
	current, err := r.GetAssetConnectionProfile(ctx, assetID, true, masterKey)
	if err != nil && !errors.Is(err, ErrConnectionProfileNotFound) {
		return AssetConnectionProfile{}, err
	}

	database := ""
	if req.Database != nil {
		database = strings.TrimSpace(*req.Database)
	} else if current.AssetID != "" {
		database = current.Database
	}
	if protocol == "postgres" && database == "" {
		database = "postgres"
	}
	var proxyID sql.NullString
	if req.ProxyID != nil {
		v := strings.TrimSpace(*req.ProxyID)
		if v != "" {
			proxyID = sql.NullString{String: v, Valid: true}
		}
	} else if current.ProxyID != "" {
		proxyID = sql.NullString{String: current.ProxyID, Valid: true}
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

	var proxyIDArg any
	if proxyID.Valid {
		proxyIDArg = proxyID.String
	} else {
		proxyIDArg = nil
	}
	_, err = r.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_connection (
    asset_id, protocol, host, port, username, auth_type, database_name,
    password_encrypted, private_key_encrypted, passphrase_encrypted,
    bastion_enabled, proxy_id
) VALUES (
    $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid
)
ON CONFLICT (asset_id) DO UPDATE SET
    protocol = EXCLUDED.protocol,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    auth_type = EXCLUDED.auth_type,
    database_name = EXCLUDED.database_name,
    password_encrypted = EXCLUDED.password_encrypted,
    private_key_encrypted = EXCLUDED.private_key_encrypted,
    passphrase_encrypted = EXCLUDED.passphrase_encrypted,
    bastion_enabled = EXCLUDED.bastion_enabled,
    proxy_id = EXCLUDED.proxy_id,
    updated_at = now()
`, assetID, protocol, host, port, username, authType, database,
		encryptedPassword, encryptedPrivateKey, encryptedPassphrase,
		bastionEnabled, proxyIDArg)
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
SET system_tags = COALESCE(system_tags, '{}'::jsonb) || $2::jsonb,
    updated_at = now()
WHERE id = $1::uuid
`, assetID, summaryRaw)
	}

	return snapshot, nil
}

// GetAssetSessionMeta returns asset name + proxy id/name for session audit stamping.
// Missing asset or proxy is not an error — empty strings are returned.
func (r *Repository) GetAssetSessionMeta(ctx context.Context, assetID string) (assetName, proxyID, proxyName string, err error) {
	var pID, pName sql.NullString
	err = r.db.QueryRowContext(ctx, `
SELECT a.name,
       COALESCE(c.proxy_id::text, ''),
       COALESCE(p.name, '')
  FROM cmdb_asset a
  LEFT JOIN cmdb_asset_connection c ON c.asset_id = a.id
  LEFT JOIN cmdb_ssh_proxy p ON p.id = c.proxy_id
 WHERE a.id = $1::uuid`, assetID).Scan(&assetName, &pID, &pName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", nil
		}
		return "", "", "", err
	}
	return assetName, pID.String, pName.String, nil
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
    COALESCE(a.key_name, ''),
    c.protocol,
    c.host,
    c.port,
    c.username,
    c.auth_type,
    COALESCE(c.database_name, ''),
    COALESCE(c.password_encrypted, ''),
    COALESCE(c.private_key_encrypted, ''),
    COALESCE(c.passphrase_encrypted, ''),
    c.proxy_id::text
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
		var proxyID sql.NullString
		if err := rows.Scan(
			&target.AssetID,
			&target.AssetName,
			&target.AssetType,
			&target.AssetEnv,
			&target.KeyName,
			&target.Protocol,
			&target.Host,
			&target.Port,
			&target.Username,
			&target.AuthType,
			&target.Database,
			&encryptedPassword,
			&encryptedPrivateKey,
			&encryptedPassphrase,
			&proxyID,
		); err != nil {
			return nil, err
		}
		if proxyID.Valid && proxyID.String != "" {
			proxyTarget, err := r.GetSSHProxyTarget(ctx, proxyID.String, masterKey)
			if err == nil {
				target.Proxy = &proxyTarget
			}
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

// GetBastionProbeTarget loads a single asset's decrypted connection profile
// formatted as a BastionProbeTarget, suitable for on-demand probes/tests.
func (r *Repository) GetBastionProbeTarget(ctx context.Context, assetID, masterKey string) (BastionProbeTarget, error) {
	if err := r.ensureAssetExists(ctx, assetID); err != nil {
		return BastionProbeTarget{}, err
	}

	var target BastionProbeTarget
	var encryptedPassword, encryptedPrivateKey, encryptedPassphrase string
	var proxyID sql.NullString
	err := r.db.QueryRowContext(ctx, `
SELECT
    a.id::text,
    a.name,
    a.type,
    a.env,
    COALESCE(a.key_name, ''),
    c.protocol,
    c.host,
    c.port,
    c.username,
    c.auth_type,
    COALESCE(c.database_name, ''),
    COALESCE(c.password_encrypted, ''),
    COALESCE(c.private_key_encrypted, ''),
    COALESCE(c.passphrase_encrypted, ''),
    c.proxy_id::text
FROM cmdb_asset_connection c
JOIN cmdb_asset a ON a.id = c.asset_id
WHERE c.asset_id = $1::uuid AND a.deleted_at IS NULL
`, assetID).Scan(
		&target.AssetID,
		&target.AssetName,
		&target.AssetType,
		&target.AssetEnv,
		&target.KeyName,
		&target.Protocol,
		&target.Host,
		&target.Port,
		&target.Username,
		&target.AuthType,
		&target.Database,
		&encryptedPassword,
		&encryptedPrivateKey,
		&encryptedPassphrase,
		&proxyID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return BastionProbeTarget{}, ErrConnectionProfileNotFound
		}
		return BastionProbeTarget{}, err
	}
	if proxyID.Valid && proxyID.String != "" {
		proxyTarget, err := r.GetSSHProxyTarget(ctx, proxyID.String, masterKey)
		if err != nil && !errors.Is(err, ErrSSHProxyNotFound) {
			return BastionProbeTarget{}, err
		}
		if err == nil {
			target.Proxy = &proxyTarget
		}
	}

	if encryptedPassword != "" {
		decrypted, err := security.Decrypt(encryptedPassword, masterKey)
		if err != nil {
			return BastionProbeTarget{}, err
		}
		target.Password = decrypted
	}
	if encryptedPrivateKey != "" {
		decrypted, err := security.Decrypt(encryptedPrivateKey, masterKey)
		if err != nil {
			return BastionProbeTarget{}, err
		}
		target.PrivateKey = decrypted
	}
	if encryptedPassphrase != "" {
		decrypted, err := security.Decrypt(encryptedPassphrase, masterKey)
		if err != nil {
			return BastionProbeTarget{}, err
		}
		target.Passphrase = decrypted
	}
	return target, nil
}

// UpdateConnectionProbeStatus writes the outcome of a probe/test attempt so
// operators can see the freshest connection health from the UI.
func (r *Repository) UpdateConnectionProbeStatus(ctx context.Context, assetID, status, message string) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE cmdb_asset_connection
SET last_probe_at = now(),
    last_probe_status = $2,
    last_probe_error = $3,
    updated_at = now()
WHERE asset_id = $1::uuid
`, assetID, status, message)
	return err
}

// ---- Asset Relations ----

func (r *Repository) UpsertRelation(ctx context.Context, fromAssetID, toAssetID, relationType, source string) (*AssetRelation, error) {
	var rel AssetRelation
	err := r.db.QueryRowContext(ctx, `
INSERT INTO cmdb_asset_relation (from_asset_id, to_asset_id, relation_type, source)
VALUES ($1::uuid, $2::uuid, $3, $4)
ON CONFLICT (from_asset_id, to_asset_id, relation_type) DO UPDATE
SET source = EXCLUDED.source, updated_at = now()
RETURNING id, from_asset_id, to_asset_id, relation_type, source, created_at, updated_at
`, fromAssetID, toAssetID, relationType, source).Scan(
		&rel.ID, &rel.FromAssetID, &rel.ToAssetID,
		&rel.RelationType, &rel.Source, &rel.CreatedAt, &rel.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &rel, nil
}

func (r *Repository) ListRelationsByAsset(ctx context.Context, assetID string) ([]AssetRelation, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT r.id, r.from_asset_id, r.to_asset_id, r.relation_type, r.source,
       COALESCE(f.name,''), COALESCE(f.type,''),
       COALESCE(t.name,''), COALESCE(t.type,''),
       r.created_at, r.updated_at
FROM cmdb_asset_relation r
LEFT JOIN cmdb_asset f ON f.id = r.from_asset_id
LEFT JOIN cmdb_asset t ON t.id = r.to_asset_id
WHERE r.from_asset_id = $1::uuid OR r.to_asset_id = $1::uuid
ORDER BY r.relation_type, r.created_at
`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rels []AssetRelation
	for rows.Next() {
		var rel AssetRelation
		if err := rows.Scan(
			&rel.ID, &rel.FromAssetID, &rel.ToAssetID,
			&rel.RelationType, &rel.Source,
			&rel.FromName, &rel.FromType,
			&rel.ToName, &rel.ToType,
			&rel.CreatedAt, &rel.UpdatedAt,
		); err != nil {
			return nil, err
		}
		rels = append(rels, rel)
	}
	return rels, rows.Err()
}

func (r *Repository) DeleteRelation(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM cmdb_asset_relation WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repository) DeleteRelationsByAssetAndSource(ctx context.Context, assetID, source string) error {
	_, err := r.db.ExecContext(ctx, `
DELETE FROM cmdb_asset_relation
WHERE (from_asset_id = $1::uuid OR to_asset_id = $1::uuid) AND source = $2
`, assetID, source)
	return err
}

// AssetFacets returns the distinct values of low-cardinality columns across
// all non-deleted assets. Used by the UI to populate filter dropdowns so
// options reflect the whole dataset, not just the current page.
type AssetFacets struct {
	Envs     []string `json:"envs"`
	Types    []string `json:"types"`
	Statuses []string `json:"statuses"`
	Sources  []string `json:"sources"`
	Regions  []string `json:"regions"`
}

func (r *Repository) ListAssetFacets(ctx context.Context) (AssetFacets, error) {
	var f AssetFacets
	load := func(col string, dst *[]string) error {
		rows, err := r.db.QueryContext(ctx, `
SELECT DISTINCT `+col+`
FROM cmdb_asset
WHERE deleted_at IS NULL AND `+col+` IS NOT NULL AND `+col+` != ''
ORDER BY 1
`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				return err
			}
			*dst = append(*dst, v)
		}
		return rows.Err()
	}
	if err := load("env", &f.Envs); err != nil {
		return f, err
	}
	if err := load("type", &f.Types); err != nil {
		return f, err
	}
	if err := load("status", &f.Statuses); err != nil {
		return f, err
	}
	if err := load("source", &f.Sources); err != nil {
		return f, err
	}
	if err := load("region", &f.Regions); err != nil {
		return f, err
	}
	return f, nil
}

func (r *Repository) LookupAssetIDByExternalID(ctx context.Context, source, externalID string) (string, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `
SELECT id FROM cmdb_asset WHERE source = $1 AND external_id = $2 AND deleted_at IS NULL LIMIT 1
`, source, externalID).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}
