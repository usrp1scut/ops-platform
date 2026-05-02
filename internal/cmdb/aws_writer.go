package cmdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"

	"ops-platform/internal/awssync"
)

// AWSWriter implements awssync.AssetWriter. It owns the cmdb_asset and
// cmdb_asset_relation SQL that backs an AWS sync round so awssync can stay
// free of cmdb table knowledge.
type AWSWriter struct {
	db *sql.DB
}

// NewAWSWriter binds the writer to the same database the Repository uses.
func NewAWSWriter(repo *Repository) *AWSWriter {
	return &AWSWriter{db: repo.db}
}

// UpsertAsset stores or refreshes a single observed AWS resource. On first
// observation we seed labels with AWS user tags and trust system_tags
// fully; on later runs we only refresh observed infra attributes and
// system_tags so human curation in labels / owner / business_unit is kept.
func (w *AWSWriter) UpsertAsset(ctx context.Context, item awssync.AssetUpsert) error {
	if strings.TrimSpace(item.ExternalID) == "" {
		return errors.New("external id is required")
	}
	if strings.TrimSpace(item.AssetType) == "" {
		return errors.New("asset type is required")
	}

	if strings.TrimSpace(item.Name) == "" {
		item.Name = item.ExternalID
	}
	if strings.TrimSpace(item.Status) == "" {
		item.Status = "active"
	}
	item.Status = strings.ToLower(strings.TrimSpace(item.Status))

	if strings.TrimSpace(item.Env) == "" {
		item.Env = "default"
	}

	if item.SystemTags == nil {
		item.SystemTags = map[string]any{}
	}
	if item.Labels == nil {
		item.Labels = map[string]any{}
	}

	rawSystem, err := json.Marshal(item.SystemTags)
	if err != nil {
		return err
	}
	rawLabels, err := json.Marshal(item.Labels)
	if err != nil {
		return err
	}

	// Single INSERT ... ON CONFLICT. The unique partial index from
	// migration 0020 enforces the (source='aws', account_id, region, type,
	// external_id) key, closing the SELECT/INSERT race that two concurrent
	// sync runs (ops-worker + manual API trigger) could exploit. Type is
	// part of the key because RDS DBInstanceIdentifier is user-controlled
	// and could collide with EC2-style identifiers within the same
	// account+region.
	//
	// On conflict we refresh observed AWS attributes and system_tags, but
	// preserve labels / owner / business_unit so human curation done in
	// the portal isn't overwritten by the next sync round.
	_, err = w.db.ExecContext(ctx, `
INSERT INTO cmdb_asset (
    id, type, name, status, env, source,
    external_id, external_arn,
    public_ip, private_ip, private_dns,
    region, zone, account_id, instance_type, os_image, vpc_id, subnet_id, key_name,
    ami_name, ami_owner_id, os_family,
    owner, business_unit,
    system_tags, labels
) VALUES (
    $1, $2, $3, $4, $5, $26,
    $6, NULLIF($7, ''),
    $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18,
    $19, $20, $21,
    $22, $23,
    $24, $25
)
ON CONFLICT (source, account_id, region, type, external_id)
WHERE source <> 'manual' AND deleted_at IS NULL AND external_id IS NOT NULL AND external_id <> ''
DO UPDATE SET
    name         = EXCLUDED.name,
    status       = EXCLUDED.status,
    env          = EXCLUDED.env,
    external_arn = EXCLUDED.external_arn,
    public_ip    = EXCLUDED.public_ip,
    private_ip   = EXCLUDED.private_ip,
    private_dns  = EXCLUDED.private_dns,
    zone         = EXCLUDED.zone,
    instance_type = EXCLUDED.instance_type,
    os_image     = EXCLUDED.os_image,
    vpc_id       = EXCLUDED.vpc_id,
    subnet_id    = EXCLUDED.subnet_id,
    key_name     = EXCLUDED.key_name,
    ami_name     = EXCLUDED.ami_name,
    ami_owner_id = EXCLUDED.ami_owner_id,
    os_family    = CASE WHEN EXCLUDED.os_family = '' THEN cmdb_asset.os_family ELSE EXCLUDED.os_family END,
    system_tags  = EXCLUDED.system_tags,
    deleted_at   = NULL,
    updated_at   = now()
`,
		uuid.NewString(),
		item.AssetType,
		item.Name,
		item.Status,
		item.Env,
		item.ExternalID,
		item.ExternalARN,
		strings.TrimSpace(item.PublicIP),
		strings.TrimSpace(item.PrivateIP),
		strings.TrimSpace(item.PrivateDNS),
		strings.TrimSpace(item.Region),
		strings.TrimSpace(item.Zone),
		strings.TrimSpace(item.AccountID),
		strings.TrimSpace(item.InstanceType),
		strings.TrimSpace(item.OSImage),
		strings.TrimSpace(item.VPCID),
		strings.TrimSpace(item.SubnetID),
		strings.TrimSpace(item.KeyName),
		strings.TrimSpace(item.AMIName),
		strings.TrimSpace(item.AMIOwnerID),
		strings.TrimSpace(item.OSFamily),
		strings.TrimSpace(item.Owner),
		strings.TrimSpace(item.BusinessUnit),
		rawSystem,
		rawLabels,
		awssync.SourceID,
	)
	return err
}

// LinkAWSRelations rebuilds in_vpc / in_subnet edges between AWS-source
// assets. Idempotent — safe to run after every sync round. Resolution
// must be scoped by (account_id, region) for the same reason UpsertAsset
// is: VPC IDs (vpc-xxx) are unique within an account+region but two
// accounts can have the same VPC ID, and we'd otherwise wire an instance
// to the wrong VPC.
func (w *AWSWriter) LinkAWSRelations(ctx context.Context) error {
	rows, err := w.db.QueryContext(ctx, `
SELECT id::text, COALESCE(account_id, ''), COALESCE(region, ''), vpc_id, subnet_id
FROM cmdb_asset
WHERE source = $1 AND deleted_at IS NULL
  AND (vpc_id != '' OR subnet_id != '')
`, awssync.SourceID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pending struct {
		assetID   string
		accountID string
		region    string
		vpcID     string
		subnetID  string
	}
	var items []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.assetID, &p.accountID, &p.region, &p.vpcID, &p.subnetID); err != nil {
			return err
		}
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Cache key includes type+account+region so two accounts can have
	// overlapping VPC IDs without cross-resolving, and a VPC ID can't
	// accidentally resolve to (e.g.) an RDS instance with the same
	// external_id within the same account.
	lookup := make(map[string]string)
	resolveID := func(externalID, assetType, accountID, region string) string {
		if externalID == "" || assetType == "" {
			return ""
		}
		key := accountID + "|" + region + "|" + assetType + "|" + externalID
		if cached, ok := lookup[key]; ok {
			return cached
		}
		var id string
		err := w.db.QueryRowContext(ctx, `
SELECT id::text FROM cmdb_asset
WHERE source = $5
  AND external_id = $1
  AND type = $2
  AND COALESCE(account_id, '') IS NOT DISTINCT FROM COALESCE($3, '')
  AND COALESCE(region, '')     IS NOT DISTINCT FROM COALESCE($4, '')
  AND deleted_at IS NULL
LIMIT 1
`, externalID, assetType, accountID, region, awssync.SourceID).Scan(&id)
		if err != nil {
			lookup[key] = ""
			return ""
		}
		lookup[key] = id
		return id
	}

	var relErr error
	for _, item := range items {
		if item.vpcID != "" {
			if targetID := resolveID(item.vpcID, "aws_vpc", item.accountID, item.region); targetID != "" && targetID != item.assetID {
				_, err := w.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_relation (from_asset_id, to_asset_id, relation_type, source)
VALUES ($1::uuid, $2::uuid, 'in_vpc', $3)
ON CONFLICT (from_asset_id, to_asset_id, relation_type) DO UPDATE SET updated_at = now()
`, item.assetID, targetID, awssync.SourceID)
				if err != nil {
					relErr = errors.Join(relErr, err)
				}
			}
		}
		if item.subnetID != "" {
			// We don't currently sync subnets as their own assets, but if
			// they're added later this lookup will find them by type. Until
			// then it's a no-op.
			if targetID := resolveID(item.subnetID, "aws_subnet", item.accountID, item.region); targetID != "" && targetID != item.assetID {
				_, err := w.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_relation (from_asset_id, to_asset_id, relation_type, source)
VALUES ($1::uuid, $2::uuid, 'in_subnet', $3)
ON CONFLICT (from_asset_id, to_asset_id, relation_type) DO UPDATE SET updated_at = now()
`, item.assetID, targetID, awssync.SourceID)
				if err != nil {
					relErr = errors.Join(relErr, err)
				}
			}
		}
	}
	return relErr
}
