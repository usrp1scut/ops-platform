package cmdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"ops-platform/internal/sshproxy"
)

// VPCProxyService owns the cross-aggregate orchestration for promoting an
// asset to its VPC's SSH bastion, demoting it back, and reapplying peer
// routing after sync. The Repository remains responsible for single-row
// persistence; this service owns the transaction boundary and the rules
// that span asset / ssh_proxy / asset_connection tables.
type VPCProxyService struct {
	repo *Repository
	db   *sql.DB
}

// NewVPCProxyService binds the service to an existing Repository so that
// asset reads share the same code path as everywhere else.
func NewVPCProxyService(repo *Repository) *VPCProxyService {
	return &VPCProxyService{repo: repo, db: repo.db}
}

// Promote marks the asset as the designated SSH bastion for its VPC,
// (re)creates a matching cmdb_ssh_proxy record that dials via the asset's
// public IP, and repoints every peer asset in the same VPC through the proxy
// using private IPs. Peer connection profiles only change when they are
// auto_managed (never created or last edited by this code).
func (s *VPCProxyService) Promote(ctx context.Context, assetID string, opts PromoteOptions) (Asset, sshproxy.SSHProxy, error) {
	asset, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}
	if asset.PublicIP == "" || asset.VPCID == "" {
		return Asset{}, sshproxy.SSHProxy{}, ErrAssetMissingNetwork
	}

	username := strings.TrimSpace(opts.Username)
	if username == "" {
		username = DefaultUsernameForOSFamily(asset.OSFamily)
	}
	if username == "" {
		return Asset{}, sshproxy.SSHProxy{}, ErrAssetUsernameUnresolved
	}

	authType := strings.ToLower(strings.TrimSpace(opts.AuthType))
	if authType == "" {
		if asset.KeyName != "" {
			authType = "key"
		} else {
			authType = "password"
		}
	}

	var existingPromoted string
	err = s.db.QueryRowContext(ctx, `
SELECT id::text FROM cmdb_asset
WHERE vpc_id = $1 AND is_vpc_proxy = true AND deleted_at IS NULL AND id::text <> $2
LIMIT 1
`, asset.VPCID, asset.ID).Scan(&existingPromoted)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Asset{}, sshproxy.SSHProxy{}, err
	}
	if existingPromoted != "" {
		return Asset{}, sshproxy.SSHProxy{}, fmt.Errorf("%w: asset %s", ErrVPCProxyAlreadyExists, existingPromoted)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `UPDATE cmdb_asset SET is_vpc_proxy = true, updated_at = now() WHERE id = $1::uuid`, asset.ID); err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}

	proxy, err := upsertProxyForAsset(ctx, tx, asset, username, authType)
	if err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}

	if err := ensureProxyAssetConnection(ctx, tx, asset, username, authType); err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}

	if err := propagateProxyToVPCPeers(ctx, tx, asset.VPCID, asset.ID, proxy.ID); err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}

	if err := tx.Commit(); err != nil {
		return Asset{}, sshproxy.SSHProxy{}, err
	}

	refreshed, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return Asset{}, proxy, err
	}
	return refreshed, proxy, nil
}

// Demote clears the VPC-proxy role, soft-deletes the managed proxy record,
// and nulls out proxy_id on auto-managed peer connections. User-edited peer
// connections (auto_managed=false) are left untouched.
func (s *VPCProxyService) Demote(ctx context.Context, assetID string) error {
	asset, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return err
	}
	if !asset.IsVPCProxy {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var proxyID string
	err = tx.QueryRowContext(ctx, `
SELECT id::text FROM cmdb_ssh_proxy
WHERE source_asset_id = $1::uuid AND deleted_at IS NULL
LIMIT 1
`, asset.ID).Scan(&proxyID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	if proxyID != "" {
		if _, err := tx.ExecContext(ctx,
			`UPDATE cmdb_asset_connection SET proxy_id = NULL, updated_at = now() WHERE proxy_id = $1::uuid AND auto_managed = true`,
			proxyID,
		); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE cmdb_ssh_proxy SET deleted_at = now() WHERE id = $1::uuid`, proxyID); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE cmdb_asset SET is_vpc_proxy = false, updated_at = now() WHERE id = $1::uuid`,
		asset.ID,
	); err != nil {
		return err
	}

	return tx.Commit()
}

// ReapplyPropagation re-runs peer propagation for every VPC that has a
// promoted proxy. Intended to be called after an AWS sync so newly-imported
// assets inherit the proxy routing automatically.
func (s *VPCProxyService) ReapplyPropagation(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id::text, a.vpc_id, p.id::text
FROM cmdb_asset a
JOIN cmdb_ssh_proxy p ON p.source_asset_id = a.id AND p.deleted_at IS NULL
WHERE a.is_vpc_proxy = true AND a.deleted_at IS NULL
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type target struct {
		assetID string
		vpcID   string
		proxyID string
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.assetID, &t.vpcID, &t.proxyID); err != nil {
			return err
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, t := range targets {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if err := propagateProxyToVPCPeers(ctx, tx, t.vpcID, t.assetID, t.proxyID); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
