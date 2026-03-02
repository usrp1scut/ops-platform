package aws

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"ops-platform/internal/security"
)

var ErrAccountNotFound = errors.New("aws account not found")

type Repository struct {
	db        *sql.DB
	masterKey string
}

func NewRepository(db *sql.DB, masterKey string) *Repository {
	return &Repository{db: db, masterKey: masterKey}
}

func (r *Repository) ListAccounts(ctx context.Context) ([]Account, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, account_id, display_name, auth_mode, COALESCE(role_arn, ''), COALESCE(external_id, ''), COALESCE(access_key_id, ''), region_allowlist, enabled, created_at, updated_at
FROM aws_account
ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var item Account
		var regionsRaw []byte
		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.DisplayName,
			&item.AuthMode,
			&item.RoleARN,
			&item.ExternalID,
			&item.AccessKeyID,
			&regionsRaw,
			&item.Enabled,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(regionsRaw, &item.RegionAllowlist); err != nil {
			return nil, err
		}
		accounts = append(accounts, item)
	}
	return accounts, rows.Err()
}

func (r *Repository) CreateAccount(ctx context.Context, req CreateAccountRequest) (Account, error) {
	id := uuid.NewString()
	encodedRegions, err := json.Marshal(req.RegionAllowlist)
	if err != nil {
		return Account{}, err
	}

	encryptedSecret, err := security.Encrypt(req.SecretAccessKey, r.masterKey)
	if err != nil {
		return Account{}, err
	}

	var acc Account
	var regionRaw []byte
	query := `
INSERT INTO aws_account (
	id, account_id, display_name, auth_mode, role_arn, external_id, access_key_id, secret_access_key_encrypted, region_allowlist, enabled
) VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9, $10)
RETURNING id, account_id, display_name, auth_mode, COALESCE(role_arn, ''), COALESCE(external_id, ''), COALESCE(access_key_id, ''), region_allowlist, enabled, created_at, updated_at`
	err = r.db.QueryRowContext(ctx, query,
		id,
		req.AccountID,
		req.DisplayName,
		req.AuthMode,
		req.RoleARN,
		req.ExternalID,
		req.AccessKeyID,
		encryptedSecret,
		encodedRegions,
		req.Enabled,
	).Scan(
		&acc.ID,
		&acc.AccountID,
		&acc.DisplayName,
		&acc.AuthMode,
		&acc.RoleARN,
		&acc.ExternalID,
		&acc.AccessKeyID,
		&regionRaw,
		&acc.Enabled,
		&acc.CreatedAt,
		&acc.UpdatedAt,
	)
	if err != nil {
		return Account{}, err
	}
	if err := json.Unmarshal(regionRaw, &acc.RegionAllowlist); err != nil {
		return Account{}, err
	}
	return acc, nil
}

func (r *Repository) GetAccount(ctx context.Context, id string) (Account, error) {
	var acc Account
	var regionsRaw []byte

	err := r.db.QueryRowContext(ctx, `
SELECT id, account_id, display_name, auth_mode, COALESCE(role_arn, ''), COALESCE(external_id, ''), COALESCE(access_key_id, ''), region_allowlist, enabled, created_at, updated_at
FROM aws_account
WHERE id = $1`, id).Scan(
		&acc.ID,
		&acc.AccountID,
		&acc.DisplayName,
		&acc.AuthMode,
		&acc.RoleARN,
		&acc.ExternalID,
		&acc.AccessKeyID,
		&regionsRaw,
		&acc.Enabled,
		&acc.CreatedAt,
		&acc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Account{}, ErrAccountNotFound
		}
		return Account{}, err
	}
	if err := json.Unmarshal(regionsRaw, &acc.RegionAllowlist); err != nil {
		return Account{}, err
	}
	return acc, nil
}

func (r *Repository) UpdateAccount(ctx context.Context, id string, req UpdateAccountRequest) (Account, error) {
	current, err := r.GetAccount(ctx, id)
	if err != nil {
		return Account{}, err
	}

	roleARN := current.RoleARN
	if req.RoleARN != nil {
		roleARN = *req.RoleARN
	}
	externalID := current.ExternalID
	if req.ExternalID != nil {
		externalID = *req.ExternalID
	}
	accessKeyID := current.AccessKeyID
	if req.AccessKeyID != nil {
		accessKeyID = *req.AccessKeyID
	}
	displayName := current.DisplayName
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	enabled := current.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	regions := current.RegionAllowlist
	if req.RegionAllowlist != nil {
		regions = req.RegionAllowlist
	}
	regionsRaw, err := json.Marshal(regions)
	if err != nil {
		return Account{}, err
	}

	encryptedSecret := ""
	if req.SecretAccessKey != nil {
		encryptedSecret, err = security.Encrypt(*req.SecretAccessKey, r.masterKey)
		if err != nil {
			return Account{}, err
		}
	}

	var updated Account
	var updatedRegions []byte
	query := `
UPDATE aws_account
SET display_name = $2,
	role_arn = NULLIF($3, ''),
	external_id = NULLIF($4, ''),
	access_key_id = NULLIF($5, ''),
	region_allowlist = $6,
	enabled = $7,
	secret_access_key_encrypted = COALESCE(NULLIF($8, ''), secret_access_key_encrypted),
	updated_at = now()
WHERE id = $1
RETURNING id, account_id, display_name, auth_mode, COALESCE(role_arn, ''), COALESCE(external_id, ''), COALESCE(access_key_id, ''), region_allowlist, enabled, created_at, updated_at`
	err = r.db.QueryRowContext(ctx, query,
		id, displayName, roleARN, externalID, accessKeyID, regionsRaw, enabled, encryptedSecret,
	).Scan(
		&updated.ID,
		&updated.AccountID,
		&updated.DisplayName,
		&updated.AuthMode,
		&updated.RoleARN,
		&updated.ExternalID,
		&updated.AccessKeyID,
		&updatedRegions,
		&updated.Enabled,
		&updated.CreatedAt,
		&updated.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Account{}, ErrAccountNotFound
		}
		return Account{}, err
	}
	if err := json.Unmarshal(updatedRegions, &updated.RegionAllowlist); err != nil {
		return Account{}, err
	}
	return updated, nil
}

func (r *Repository) ListSyncAccounts(ctx context.Context) ([]SyncAccount, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT
    id,
    account_id,
    display_name,
    auth_mode,
    COALESCE(role_arn, ''),
    COALESCE(external_id, ''),
    COALESCE(access_key_id, ''),
    COALESCE(secret_access_key_encrypted, ''),
    region_allowlist,
    enabled
FROM aws_account
WHERE enabled = true
ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]SyncAccount, 0, 16)
	for rows.Next() {
		var item SyncAccount
		var regionsRaw []byte
		var encryptedSecret string
		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.DisplayName,
			&item.AuthMode,
			&item.RoleARN,
			&item.ExternalID,
			&item.AccessKeyID,
			&encryptedSecret,
			&regionsRaw,
			&item.Enabled,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(regionsRaw, &item.RegionAllowlist); err != nil {
			return nil, err
		}
		if encryptedSecret != "" {
			decrypted, err := security.Decrypt(encryptedSecret, r.masterKey)
			if err != nil {
				return nil, fmt.Errorf("decrypt account secret for %s: %w", item.AccountID, err)
			}
			item.SecretAccessKey = decrypted
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) StartSyncRun(ctx context.Context, accountUUID, region, resourceType string) (string, error) {
	var id string
	err := r.db.QueryRowContext(ctx, `
INSERT INTO aws_sync_run (account_id, region, resource_type, status)
VALUES ($1::uuid, $2, $3, 'running')
RETURNING id::text
`, accountUUID, region, resourceType).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (r *Repository) FinishSyncRun(ctx context.Context, runID, status string, resourcesProcessed int, errorMessage string) error {
	if status == "" {
		status = "success"
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE aws_sync_run
SET status = $2,
    resources_processed = $3,
    error_message = NULLIF($4, ''),
    finished_at = now()
WHERE id = $1::uuid
`, runID, status, resourcesProcessed, errorMessage)
	return err
}

func (r *Repository) ListSyncRuns(ctx context.Context, limit int) ([]SyncRun, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT
    run.id::text,
    account.account_id,
    account.display_name,
    run.region,
    run.resource_type,
    run.status,
    run.resources_processed,
    COALESCE(run.error_message, ''),
    run.started_at,
    run.finished_at
FROM aws_sync_run run
JOIN aws_account account ON account.id = run.account_id
ORDER BY run.started_at DESC
LIMIT $1
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]SyncRun, 0, limit)
	for rows.Next() {
		var item SyncRun
		var finishedAt sql.NullTime
		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.AccountDisplayName,
			&item.Region,
			&item.ResourceType,
			&item.Status,
			&item.ResourcesProcessed,
			&item.ErrorMessage,
			&item.StartedAt,
			&finishedAt,
		); err != nil {
			return nil, err
		}
		if finishedAt.Valid {
			t := finishedAt.Time
			item.FinishedAt = &t
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
