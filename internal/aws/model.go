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
