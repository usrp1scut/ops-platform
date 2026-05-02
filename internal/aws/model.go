package aws

import "time"

type Account struct {
	ID              string    `json:"id"`
	AccountID       string    `json:"account_id"`
	DisplayName     string    `json:"display_name"`
	AuthMode        string    `json:"auth_mode"`
	RoleARN         string    `json:"role_arn,omitempty"`
	ExternalID      string    `json:"external_id,omitempty"`
	AccessKeyID     string    `json:"access_key_id,omitempty"`
	RegionAllowlist []string  `json:"region_allowlist"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type CreateAccountRequest struct {
	AccountID       string   `json:"account_id"`
	DisplayName     string   `json:"display_name"`
	AuthMode        string   `json:"auth_mode"`
	RoleARN         string   `json:"role_arn"`
	ExternalID      string   `json:"external_id"`
	AccessKeyID     string   `json:"access_key_id"`
	SecretAccessKey string   `json:"secret_access_key"`
	RegionAllowlist []string `json:"region_allowlist"`
	Enabled         bool     `json:"enabled"`
}

type UpdateAccountRequest struct {
	DisplayName     *string  `json:"display_name"`
	RoleARN         *string  `json:"role_arn"`
	ExternalID      *string  `json:"external_id"`
	AccessKeyID     *string  `json:"access_key_id"`
	SecretAccessKey *string  `json:"secret_access_key"`
	RegionAllowlist []string `json:"region_allowlist"`
	Enabled         *bool    `json:"enabled"`
}

type SyncAccount struct {
	ID              string
	AccountID       string
	DisplayName     string
	AuthMode        string
	RoleARN         string
	ExternalID      string
	AccessKeyID     string
	SecretAccessKey string
	RegionAllowlist []string
	Enabled         bool
}

type SyncRun struct {
	ID                 string     `json:"id"`
	AccountID          string     `json:"account_id"`
	AccountDisplayName string     `json:"account_display_name"`
	Region             string     `json:"region"`
	ResourceType       string     `json:"resource_type"`
	Status             string     `json:"status"`
	ResourcesProcessed int        `json:"resources_processed"`
	ErrorMessage       string     `json:"error_message,omitempty"`
	StartedAt          time.Time  `json:"started_at"`
	FinishedAt         *time.Time `json:"finished_at,omitempty"`
}

type ConnectionTestResult struct {
	Status    string    `json:"status"`
	Region    string    `json:"region"`
	AccountID string    `json:"account_id"`
	Arn       string    `json:"arn"`
	UserID    string    `json:"user_id"`
	CheckedAt time.Time `json:"checked_at"`
}
