// Package bastion implements just-in-time (JIT) bastion access:
// time-bounded grants and the request/approval workflow that produces them.
//
// Issuing a terminal or RDP ticket calls into this package to verify the
// caller has an active grant for the target asset (or is an admin who
// bypasses the gate). See ADR-0009 for the design.
package bastion

import (
	"errors"
	"time"
)

var (
	ErrGrantNotFound      = errors.New("grant not found")
	ErrRequestNotFound    = errors.New("request not found")
	ErrRequestNotPending  = errors.New("request is not pending")
	ErrSelfApprovalDenied = errors.New("you cannot approve your own request")
	// ErrSelfGrantDenied closes the loop with ErrSelfApprovalDenied:
	// approval is already two-person, but a direct grant would let an
	// approver bypass that by issuing a grant to themselves. Block both.
	ErrSelfGrantDenied = errors.New("you cannot grant access to yourself")
	ErrNoActiveGrant   = errors.New("no active grant for this asset")
)

// RequestStatus enumerates lifecycle states. The DB constraint mirrors this.
type RequestStatus string

const (
	RequestStatusPending   RequestStatus = "pending"
	RequestStatusApproved  RequestStatus = "approved"
	RequestStatusRejected  RequestStatus = "rejected"
	RequestStatusCancelled RequestStatus = "cancelled"
	RequestStatusExpired   RequestStatus = "expired"
)

type Grant struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	UserName      string     `json:"user_name"`
	AssetID       string     `json:"asset_id"`
	AssetName     string     `json:"asset_name"`
	GrantedByID   string     `json:"granted_by_id"`
	GrantedByName string     `json:"granted_by_name"`
	Reason        string     `json:"reason,omitempty"`
	ExpiresAt     time.Time  `json:"expires_at"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	RevokedByID   string     `json:"revoked_by_id,omitempty"`
	RevokedByName string     `json:"revoked_by_name,omitempty"`
	RevokeReason  string     `json:"revoke_reason,omitempty"`
	RequestID     string     `json:"request_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	// Active is computed at read time so callers don't have to repeat
	// the (revoked_at IS NULL AND expires_at > now()) test.
	Active bool `json:"active"`
}

type CreateGrantInput struct {
	UserID    string
	AssetID   string
	Reason    string
	ExpiresAt time.Time
	// RequestID links this grant back to the approval request it was issued
	// from. Empty for direct grants.
	RequestID string
}

type RevokeGrantInput struct {
	GrantID      string
	RevokedByID  string
	RevokeReason string
}

type Request struct {
	ID                       string        `json:"id"`
	UserID                   string        `json:"user_id"`
	UserName                 string        `json:"user_name"`
	AssetID                  string        `json:"asset_id"`
	AssetName                string        `json:"asset_name"`
	Reason                   string        `json:"reason,omitempty"`
	RequestedDurationSeconds int           `json:"requested_duration_seconds"`
	Status                   RequestStatus `json:"status"`
	DecidedByID              string        `json:"decided_by_id,omitempty"`
	DecidedByName            string        `json:"decided_by_name,omitempty"`
	DecidedAt                *time.Time    `json:"decided_at,omitempty"`
	DecisionReason           string        `json:"decision_reason,omitempty"`
	GrantID                  string        `json:"grant_id,omitempty"`
	CreatedAt                time.Time     `json:"created_at"`
	UpdatedAt                time.Time     `json:"updated_at"`
}

type CreateRequestInput struct {
	UserID                   string
	AssetID                  string
	Reason                   string
	RequestedDurationSeconds int
}

type DecideRequestInput struct {
	RequestID      string
	DecidedByID    string
	DecisionReason string
}

// ListGrantsQuery filters the grant list. UserID/AssetID may be empty;
// ActiveOnly excludes revoked or expired entries when true.
type ListGrantsQuery struct {
	UserID     string
	AssetID    string
	ActiveOnly bool
	Limit      int
	Offset     int
}

type ListRequestsQuery struct {
	UserID string
	Status RequestStatus // empty = all
	Limit  int
	Offset int
}
