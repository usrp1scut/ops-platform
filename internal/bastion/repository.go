package bastion

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

const grantColumns = `
g.id::text,
g.user_id::text,
COALESCE(g.user_name, ''),
g.asset_id::text,
COALESCE(g.asset_name, ''),
g.granted_by_id::text,
COALESCE(g.granted_by_name, ''),
COALESCE(g.reason, ''),
g.expires_at,
g.revoked_at,
COALESCE(g.revoked_by_id::text, ''),
COALESCE(g.revoked_by_name, ''),
COALESCE(g.revoke_reason, ''),
COALESCE(g.request_id::text, ''),
g.created_at`

func scanGrant(row interface {
	Scan(dest ...any) error
}) (Grant, error) {
	var g Grant
	var revoked sql.NullTime
	if err := row.Scan(
		&g.ID,
		&g.UserID,
		&g.UserName,
		&g.AssetID,
		&g.AssetName,
		&g.GrantedByID,
		&g.GrantedByName,
		&g.Reason,
		&g.ExpiresAt,
		&revoked,
		&g.RevokedByID,
		&g.RevokedByName,
		&g.RevokeReason,
		&g.RequestID,
		&g.CreatedAt,
	); err != nil {
		return Grant{}, err
	}
	if revoked.Valid {
		t := revoked.Time
		g.RevokedAt = &t
	}
	g.Active = g.RevokedAt == nil && g.ExpiresAt.After(time.Now())
	return g, nil
}

// FindActiveGrant returns the highest-expiring active grant for (user, asset)
// or ErrGrantNotFound if none exists. Used by the ticket-issue gate, so
// hot-path: the supporting index is idx_bastion_grant_active.
func (r *Repository) FindActiveGrant(ctx context.Context, userID, assetID string) (Grant, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT `+grantColumns+`
FROM bastion_grant g
WHERE g.user_id = $1::uuid AND g.asset_id = $2::uuid
  AND g.revoked_at IS NULL AND g.expires_at > now()
ORDER BY g.expires_at DESC
LIMIT 1`, userID, assetID)
	g, err := scanGrant(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Grant{}, ErrGrantNotFound
		}
		return Grant{}, err
	}
	return g, nil
}

func (r *Repository) GetGrant(ctx context.Context, id string) (Grant, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+grantColumns+` FROM bastion_grant g WHERE g.id = $1::uuid`, id)
	g, err := scanGrant(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Grant{}, ErrGrantNotFound
		}
		return Grant{}, err
	}
	return g, nil
}

// userAndAssetMeta loads denormalized name fields so grant rows display
// without a join at read time. Returns empty strings when not found.
func (r *Repository) userAndAssetMeta(ctx context.Context, userID, assetID, granterID string) (userName, assetName, granterName string) {
	_ = r.db.QueryRowContext(ctx, `SELECT COALESCE(name, '') FROM iam_user WHERE id = $1::uuid`, userID).Scan(&userName)
	_ = r.db.QueryRowContext(ctx, `SELECT COALESCE(name, '') FROM cmdb_asset WHERE id = $1::uuid`, assetID).Scan(&assetName)
	_ = r.db.QueryRowContext(ctx, `SELECT COALESCE(name, '') FROM iam_user WHERE id = $1::uuid`, granterID).Scan(&granterName)
	return
}

// CreateGrant issues a direct grant. Used by approval flow as well, with
// requestID set; for direct grants the caller passes empty.
func (r *Repository) CreateGrant(ctx context.Context, in CreateGrantInput, granterID string) (Grant, error) {
	userName, assetName, granterName := r.userAndAssetMeta(ctx, in.UserID, in.AssetID, granterID)
	id := uuid.NewString()
	var requestID any
	if strings.TrimSpace(in.RequestID) != "" {
		requestID = in.RequestID
	}
	if _, err := r.db.ExecContext(ctx, `
INSERT INTO bastion_grant (id, user_id, user_name, asset_id, asset_name,
    granted_by_id, granted_by_name, reason, expires_at, request_id)
VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7, $8, $9, $10::uuid)`,
		id, in.UserID, userName, in.AssetID, assetName,
		granterID, granterName, in.Reason, in.ExpiresAt, requestID,
	); err != nil {
		return Grant{}, err
	}
	return r.GetGrant(ctx, id)
}

// RevokeGrant marks the grant revoked. Idempotent: revoking an already
// revoked grant returns ErrGrantNotFound for "no rows changed" so the caller
// can return 404 — slightly conservative but avoids ambiguity.
func (r *Repository) RevokeGrant(ctx context.Context, in RevokeGrantInput, revokerName string) error {
	res, err := r.db.ExecContext(ctx, `
UPDATE bastion_grant
SET revoked_at = now(),
    revoked_by_id = $2::uuid,
    revoked_by_name = $3,
    revoke_reason = $4
WHERE id = $1::uuid AND revoked_at IS NULL`,
		in.GrantID, in.RevokedByID, revokerName, in.RevokeReason)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrGrantNotFound
	}
	return nil
}

func (r *Repository) ListGrants(ctx context.Context, q ListGrantsQuery) ([]Grant, error) {
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1=1"}
	args := []any{}
	idx := 1
	if strings.TrimSpace(q.UserID) != "" {
		where = append(where, "g.user_id = $"+itoa(idx)+"::uuid")
		args = append(args, q.UserID)
		idx++
	}
	if strings.TrimSpace(q.AssetID) != "" {
		where = append(where, "g.asset_id = $"+itoa(idx)+"::uuid")
		args = append(args, q.AssetID)
		idx++
	}
	if q.ActiveOnly {
		where = append(where, "g.revoked_at IS NULL AND g.expires_at > now()")
	}
	args = append(args, limit, q.Offset)
	query := `
SELECT ` + grantColumns + `
FROM bastion_grant g
WHERE ` + strings.Join(where, " AND ") + `
ORDER BY g.created_at DESC
LIMIT $` + itoa(idx) + ` OFFSET $` + itoa(idx+1)
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Grant, 0)
	for rows.Next() {
		g, err := scanGrant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

const requestColumns = `
r.id::text,
r.user_id::text,
COALESCE(r.user_name, ''),
r.asset_id::text,
COALESCE(r.asset_name, ''),
COALESCE(r.reason, ''),
r.requested_duration_seconds,
r.status,
COALESCE(r.decided_by_id::text, ''),
COALESCE(r.decided_by_name, ''),
r.decided_at,
COALESCE(r.decision_reason, ''),
COALESCE(r.grant_id::text, ''),
r.created_at,
r.updated_at`

func scanRequest(row interface {
	Scan(dest ...any) error
}) (Request, error) {
	var req Request
	var decidedAt sql.NullTime
	var status string
	if err := row.Scan(
		&req.ID,
		&req.UserID,
		&req.UserName,
		&req.AssetID,
		&req.AssetName,
		&req.Reason,
		&req.RequestedDurationSeconds,
		&status,
		&req.DecidedByID,
		&req.DecidedByName,
		&decidedAt,
		&req.DecisionReason,
		&req.GrantID,
		&req.CreatedAt,
		&req.UpdatedAt,
	); err != nil {
		return Request{}, err
	}
	req.Status = RequestStatus(status)
	if decidedAt.Valid {
		t := decidedAt.Time
		req.DecidedAt = &t
	}
	return req, nil
}

func (r *Repository) GetRequest(ctx context.Context, id string) (Request, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM bastion_request r WHERE r.id = $1::uuid`, id)
	req, err := scanRequest(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Request{}, ErrRequestNotFound
		}
		return Request{}, err
	}
	return req, nil
}

func (r *Repository) CreateRequest(ctx context.Context, in CreateRequestInput) (Request, error) {
	userName, assetName, _ := r.userAndAssetMeta(ctx, in.UserID, in.AssetID, in.UserID)
	id := uuid.NewString()
	if _, err := r.db.ExecContext(ctx, `
INSERT INTO bastion_request (id, user_id, user_name, asset_id, asset_name,
    reason, requested_duration_seconds)
VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7)`,
		id, in.UserID, userName, in.AssetID, assetName,
		in.Reason, in.RequestedDurationSeconds); err != nil {
		return Request{}, err
	}
	return r.GetRequest(ctx, id)
}

func (r *Repository) ListRequests(ctx context.Context, q ListRequestsQuery) ([]Request, error) {
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1=1"}
	args := []any{}
	idx := 1
	if strings.TrimSpace(q.UserID) != "" {
		where = append(where, "r.user_id = $"+itoa(idx)+"::uuid")
		args = append(args, q.UserID)
		idx++
	}
	if string(q.Status) != "" {
		where = append(where, "r.status = $"+itoa(idx))
		args = append(args, string(q.Status))
		idx++
	}
	args = append(args, limit, q.Offset)
	query := `
SELECT ` + requestColumns + `
FROM bastion_request r
WHERE ` + strings.Join(where, " AND ") + `
ORDER BY r.created_at DESC
LIMIT $` + itoa(idx) + ` OFFSET $` + itoa(idx+1)
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Request, 0)
	for rows.Next() {
		req, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}

// ApproveRequest is the cross-aggregate Tx: it transitions the request to
// approved, creates the grant, and stamps the grant_id on the request — all
// in one transaction so a partial commit can never produce an approved
// request without a grant (or vice versa).
func (r *Repository) ApproveRequest(ctx context.Context, in DecideRequestInput, approverName string) (Request, Grant, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Request{}, Grant{}, err
	}
	defer tx.Rollback()

	// Lock the request row so concurrent approvals serialize.
	var status string
	var userID, assetID, userName, assetName string
	var duration int
	err = tx.QueryRowContext(ctx, `
SELECT status, user_id::text, COALESCE(user_name, ''), asset_id::text, COALESCE(asset_name, ''), requested_duration_seconds
FROM bastion_request WHERE id = $1::uuid FOR UPDATE`, in.RequestID).
		Scan(&status, &userID, &userName, &assetID, &assetName, &duration)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Request{}, Grant{}, ErrRequestNotFound
		}
		return Request{}, Grant{}, err
	}
	if RequestStatus(status) != RequestStatusPending {
		return Request{}, Grant{}, ErrRequestNotPending
	}
	if userID == in.DecidedByID {
		return Request{}, Grant{}, ErrSelfApprovalDenied
	}

	expiresAt := time.Now().Add(time.Duration(duration) * time.Second)

	grantID := uuid.NewString()
	if _, err := tx.ExecContext(ctx, `
INSERT INTO bastion_grant (id, user_id, user_name, asset_id, asset_name,
    granted_by_id, granted_by_name, reason, expires_at, request_id)
VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7, $8, $9, $10::uuid)`,
		grantID, userID, userName, assetID, assetName,
		in.DecidedByID, approverName, in.DecisionReason, expiresAt, in.RequestID,
	); err != nil {
		return Request{}, Grant{}, err
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE bastion_request
SET status = 'approved',
    decided_by_id = $2::uuid,
    decided_by_name = $3,
    decided_at = now(),
    decision_reason = $4,
    grant_id = $5::uuid,
    updated_at = now()
WHERE id = $1::uuid`, in.RequestID, in.DecidedByID, approverName, in.DecisionReason, grantID); err != nil {
		return Request{}, Grant{}, err
	}

	if err := tx.Commit(); err != nil {
		return Request{}, Grant{}, err
	}

	req, err := r.GetRequest(ctx, in.RequestID)
	if err != nil {
		return Request{}, Grant{}, err
	}
	g, err := r.GetGrant(ctx, grantID)
	if err != nil {
		return req, Grant{}, err
	}
	return req, g, nil
}

func (r *Repository) RejectRequest(ctx context.Context, in DecideRequestInput, deciderName string) (Request, error) {
	res, err := r.db.ExecContext(ctx, `
UPDATE bastion_request
SET status = 'rejected',
    decided_by_id = $2::uuid,
    decided_by_name = $3,
    decided_at = now(),
    decision_reason = $4,
    updated_at = now()
WHERE id = $1::uuid AND status = 'pending'`,
		in.RequestID, in.DecidedByID, deciderName, in.DecisionReason)
	if err != nil {
		return Request{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Request{}, ErrRequestNotPending
	}
	return r.GetRequest(ctx, in.RequestID)
}

func (r *Repository) CancelRequest(ctx context.Context, requestID, userID string) (Request, error) {
	// Only the original requester can cancel their own pending request.
	res, err := r.db.ExecContext(ctx, `
UPDATE bastion_request
SET status = 'cancelled',
    updated_at = now()
WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'pending'`,
		requestID, userID)
	if err != nil {
		return Request{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Request{}, ErrRequestNotPending
	}
	return r.GetRequest(ctx, requestID)
}

func itoa(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	buf := make([]byte, 0, 4)
	for i > 0 {
		buf = append([]byte{digits[i%10]}, buf...)
		i /= 10
	}
	return string(buf)
}
