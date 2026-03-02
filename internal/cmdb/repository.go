package cmdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
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
