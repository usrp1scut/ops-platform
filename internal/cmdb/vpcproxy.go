package cmdb

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	"ops-platform/internal/sshproxy"
)

// PromoteOptions tweaks how an asset is promoted to VPC SSH proxy. All
// fields are optional; blanks fall back to values derived from the asset.
type PromoteOptions struct {
	Username string
	AuthType string // "password" | "key"; defaults to "key" when asset has a key_name
}

var (
	ErrAssetMissingNetwork     = errors.New("asset missing public_ip or vpc_id; cannot be promoted")
	ErrAssetUsernameUnresolved = errors.New("cannot derive SSH username from os_family; pass an explicit username")
	ErrVPCProxyAlreadyExists   = errors.New("another asset is already the VPC SSH proxy")
)

func upsertProxyForAsset(ctx context.Context, tx *sql.Tx, asset Asset, username, authType string) (sshproxy.SSHProxy, error) {
	name := asset.VPCID + "-proxy"
	if asset.Name != "" {
		name = asset.VPCID + "-" + asset.Name
	}
	description := "Auto-managed proxy for VPC " + asset.VPCID + " (source asset: " + asset.Name + ")"

	// Prefer reviving any row (including soft-deleted) tied to this source
	// asset so the proxy ID stays stable across demote/re-promote cycles.
	var existingID string
	err := tx.QueryRowContext(ctx, `
SELECT id::text FROM cmdb_ssh_proxy
WHERE source_asset_id = $1::uuid
ORDER BY deleted_at IS NULL DESC, updated_at DESC
LIMIT 1
`, asset.ID).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sshproxy.SSHProxy{}, err
	}

	var row *sql.Row
	if existingID != "" {
		row = tx.QueryRowContext(ctx, `
UPDATE cmdb_ssh_proxy
SET name = $2,
    description = $3,
    network_zone = $4,
    host = $5,
    port = 22,
    username = $6,
    auth_type = $7,
    key_name = $8,
    deleted_at = NULL,
    updated_at = now()
WHERE id = $1::uuid
RETURNING `+sshproxy.Columns,
			existingID, name, description, asset.VPCID, asset.PublicIP, username, authType, asset.KeyName)
	} else {
		row = tx.QueryRowContext(ctx, `
INSERT INTO cmdb_ssh_proxy (
    id, name, description, network_zone, host, port, username, auth_type, key_name, source_asset_id
) VALUES ($1::uuid, $2, $3, $4, $5, 22, $6, $7, $8, $9::uuid)
RETURNING `+sshproxy.Columns,
			uuid.NewString(), name, description, asset.VPCID, asset.PublicIP, username, authType, asset.KeyName, asset.ID)
	}

	proxy, err := sshproxy.Scan(row)
	if err != nil {
		return sshproxy.SSHProxy{}, err
	}
	return proxy, nil
}

func ensureProxyAssetConnection(ctx context.Context, tx *sql.Tx, asset Asset, username, authType string) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO cmdb_asset_connection (
    asset_id, protocol, host, port, username, auth_type,
    bastion_enabled, auto_managed
) VALUES ($1::uuid, 'ssh', $2, 22, $3, $4, true, true)
ON CONFLICT (asset_id) DO UPDATE SET
    protocol = 'ssh',
    host = EXCLUDED.host,
    port = 22,
    username = EXCLUDED.username,
    auth_type = EXCLUDED.auth_type,
    proxy_id = NULL,
    bastion_enabled = true,
    auto_managed = true,
    updated_at = now()
WHERE cmdb_asset_connection.auto_managed = true OR cmdb_asset_connection.host = '' OR cmdb_asset_connection.host IS NULL
`, asset.ID, asset.PublicIP, username, authType)
	return err
}

func propagateProxyToVPCPeers(ctx context.Context, tx *sql.Tx, vpcID, sourceAssetID, proxyID string) error {
	rows, err := tx.QueryContext(ctx, `
SELECT id::text, COALESCE(private_ip, ''), COALESCE(os_family, '')
FROM cmdb_asset
WHERE vpc_id = $1 AND id::text <> $2 AND deleted_at IS NULL AND type = 'aws_ec2_instance'
`, vpcID, sourceAssetID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type peer struct {
		id        string
		privateIP string
		osFamily  string
	}
	var peers []peer
	for rows.Next() {
		var p peer
		if err := rows.Scan(&p.id, &p.privateIP, &p.osFamily); err != nil {
			return err
		}
		if p.privateIP == "" {
			continue
		}
		peers = append(peers, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range peers {
		peerUsername := DefaultUsernameForOSFamily(p.osFamily)
		if peerUsername == "" {
			continue // skip peers whose OS we can't classify; user can configure manually
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO cmdb_asset_connection (
    asset_id, protocol, host, port, username, auth_type,
    proxy_id, bastion_enabled, auto_managed
) VALUES ($1::uuid, 'ssh', $2, 22, $3, 'key', $4::uuid, true, true)
ON CONFLICT (asset_id) DO UPDATE SET
    protocol = 'ssh',
    host = EXCLUDED.host,
    port = 22,
    username = EXCLUDED.username,
    auth_type = EXCLUDED.auth_type,
    proxy_id = EXCLUDED.proxy_id,
    bastion_enabled = true,
    auto_managed = true,
    updated_at = now()
WHERE cmdb_asset_connection.auto_managed = true
`, p.id, p.privateIP, peerUsername, proxyID); err != nil {
			return err
		}
	}
	return nil
}
