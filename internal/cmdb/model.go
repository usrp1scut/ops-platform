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

type AssetConnectionProfile struct {
	AssetID        string    `json:"asset_id"`
	Protocol       string    `json:"protocol"`
	Host           string    `json:"host"`
	Port           int       `json:"port"`
	Username       string    `json:"username"`
	AuthType       string    `json:"auth_type"`
	BastionEnabled bool      `json:"bastion_enabled"`
	HasPassword    bool      `json:"has_password"`
	HasPrivateKey  bool      `json:"has_private_key"`
	HasPassphrase  bool      `json:"has_passphrase"`
	Password       string    `json:"password,omitempty"`
	PrivateKey     string    `json:"private_key,omitempty"`
	Passphrase     string    `json:"passphrase,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type UpsertAssetConnectionProfileRequest struct {
	Protocol       string  `json:"protocol"`
	Host           string  `json:"host"`
	Port           int     `json:"port"`
	Username       string  `json:"username"`
	AuthType       string  `json:"auth_type"`
	Password       *string `json:"password"`
	PrivateKey     *string `json:"private_key"`
	Passphrase     *string `json:"passphrase"`
	BastionEnabled *bool   `json:"bastion_enabled"`
}

type AssetProbeSnapshot struct {
	ID           string         `json:"id"`
	AssetID      string         `json:"asset_id"`
	OSName       string         `json:"os_name"`
	OSVersion    string         `json:"os_version"`
	Kernel       string         `json:"kernel"`
	Arch         string         `json:"arch"`
	Hostname     string         `json:"hostname"`
	UptimeSecond int64          `json:"uptime_seconds"`
	CPUModel     string         `json:"cpu_model"`
	CPUCores     int            `json:"cpu_cores"`
	MemoryMB     int            `json:"memory_mb"`
	DiskSummary  string         `json:"disk_summary"`
	Software     []string       `json:"software"`
	Raw          map[string]any `json:"raw,omitempty"`
	CollectedBy  string         `json:"collected_by"`
	CollectedAt  time.Time      `json:"collected_at"`
}

type UpsertAssetProbeSnapshotRequest struct {
	OSName       string         `json:"os_name"`
	OSVersion    string         `json:"os_version"`
	Kernel       string         `json:"kernel"`
	Arch         string         `json:"arch"`
	Hostname     string         `json:"hostname"`
	UptimeSecond int64          `json:"uptime_seconds"`
	CPUModel     string         `json:"cpu_model"`
	CPUCores     int            `json:"cpu_cores"`
	MemoryMB     int            `json:"memory_mb"`
	DiskSummary  string         `json:"disk_summary"`
	Software     []string       `json:"software"`
	Raw          map[string]any `json:"raw"`
	CollectedBy  string         `json:"collected_by"`
}

type BastionProbeTarget struct {
	AssetID    string `json:"asset_id"`
	AssetName  string `json:"asset_name"`
	AssetType  string `json:"asset_type"`
	AssetEnv   string `json:"asset_env"`
	Protocol   string `json:"protocol"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthType   string `json:"auth_type"`
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"private_key,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}
