package cmdb

import "time"

type Asset struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Status      string         `json:"status"`
	Env         string         `json:"env"`
	Source      string         `json:"source"`
	ExternalID  string         `json:"external_id,omitempty"`
	ExternalARN string         `json:"external_arn,omitempty"`
	Tags        map[string]any `json:"tags,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type CreateAssetRequest struct {
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Status      string         `json:"status"`
	Env         string         `json:"env"`
	Source      string         `json:"source"`
	ExternalID  string         `json:"external_id"`
	ExternalARN string         `json:"external_arn"`
	Tags        map[string]any `json:"tags"`
}

type UpdateAssetRequest struct {
	Name   *string        `json:"name"`
	Status *string        `json:"status"`
	Env    *string        `json:"env"`
	Tags   map[string]any `json:"tags"`
}
