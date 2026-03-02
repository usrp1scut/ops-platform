package aws

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

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
