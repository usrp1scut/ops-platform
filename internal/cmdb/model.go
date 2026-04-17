package cmdb

import "time"

type Asset struct {
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Name          string         `json:"name"`
	Status        string         `json:"status"`
	Env           string         `json:"env"`
	Source        string         `json:"source"`
	ExternalID    string         `json:"external_id,omitempty"`
	ExternalARN   string         `json:"external_arn,omitempty"`
	PublicIP      string         `json:"public_ip,omitempty"`
	PrivateIP     string         `json:"private_ip,omitempty"`
	PrivateDNS    string         `json:"private_dns,omitempty"`
	Region        string         `json:"region,omitempty"`
	Zone          string         `json:"zone,omitempty"`
	AccountID     string         `json:"account_id,omitempty"`
	InstanceType  string         `json:"instance_type,omitempty"`
	OSImage       string         `json:"os_image,omitempty"`
	VPCID         string         `json:"vpc_id,omitempty"`
	SubnetID      string         `json:"subnet_id,omitempty"`
	KeyName       string         `json:"key_name,omitempty"`
	Owner         string         `json:"owner,omitempty"`
	BusinessUnit  string         `json:"business_unit,omitempty"`
	Criticality   string         `json:"criticality,omitempty"`
	ExpiresAt     *time.Time     `json:"expires_at,omitempty"`
	SystemTags    map[string]any `json:"system_tags,omitempty"`
	Labels        map[string]any `json:"labels,omitempty"`
	// Tags is retained for backward compatibility; it is the union of system_tags and labels.
	Tags      map[string]any `json:"tags,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type CreateAssetRequest struct {
	Type         string         `json:"type"`
	Name         string         `json:"name"`
	Status       string         `json:"status"`
	Env          string         `json:"env"`
	Source       string         `json:"source"`
	ExternalID   string         `json:"external_id"`
	ExternalARN  string         `json:"external_arn"`
	PublicIP     string         `json:"public_ip"`
	PrivateIP    string         `json:"private_ip"`
	PrivateDNS   string         `json:"private_dns"`
	Region       string         `json:"region"`
	Zone         string         `json:"zone"`
	AccountID    string         `json:"account_id"`
	InstanceType string         `json:"instance_type"`
	OSImage      string         `json:"os_image"`
	VPCID        string         `json:"vpc_id"`
	SubnetID     string         `json:"subnet_id"`
	Owner        string         `json:"owner"`
	BusinessUnit string         `json:"business_unit"`
	Criticality  string         `json:"criticality"`
	ExpiresAt    *time.Time     `json:"expires_at"`
	Labels       map[string]any `json:"labels"`
	// Tags is retained for backward compatibility: callers who POST tags will have them
	// stored under labels (manual assets have no system_tags).
	Tags map[string]any `json:"tags"`
}

type UpdateAssetRequest struct {
	Name         *string        `json:"name"`
	Status       *string        `json:"status"`
	Env          *string        `json:"env"`
	PublicIP     *string        `json:"public_ip"`
	PrivateIP    *string        `json:"private_ip"`
	PrivateDNS   *string        `json:"private_dns"`
	Region       *string        `json:"region"`
	Zone         *string        `json:"zone"`
	AccountID    *string        `json:"account_id"`
	InstanceType *string        `json:"instance_type"`
	OSImage      *string        `json:"os_image"`
	VPCID        *string        `json:"vpc_id"`
	SubnetID     *string        `json:"subnet_id"`
	Owner        *string        `json:"owner"`
	BusinessUnit *string        `json:"business_unit"`
	Criticality  *string        `json:"criticality"`
	ExpiresAt    *time.Time     `json:"expires_at"`
	Labels       map[string]any `json:"labels"`
}

type ListAssetsQuery struct {
	Type        string
	Env         string
	Status      string
	Source      string
	Region      string
	AccountID   string
	Owner       string
	Criticality string
	Query       string
	Limit       int
	Offset      int
}

type ListAssetsResult struct {
	Items  []Asset `json:"items"`
	Total  int     `json:"total"`
	Limit  int     `json:"limit"`
	Offset int     `json:"offset"`
}

type AssetConnectionProfile struct {
	AssetID         string     `json:"asset_id"`
	Protocol        string     `json:"protocol"`
	Host            string     `json:"host"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthType        string     `json:"auth_type"`
	Database        string     `json:"database,omitempty"`
	BastionEnabled  bool       `json:"bastion_enabled"`
	ProxyID         string     `json:"proxy_id,omitempty"`
	ProxyName       string     `json:"proxy_name,omitempty"`
	ProxyZone       string     `json:"proxy_zone,omitempty"`
	HasPassword     bool       `json:"has_password"`
	HasPrivateKey   bool       `json:"has_private_key"`
	HasPassphrase   bool       `json:"has_passphrase"`
	Password        string     `json:"password,omitempty"`
	PrivateKey      string     `json:"private_key,omitempty"`
	Passphrase      string     `json:"passphrase,omitempty"`
	LastProbeAt     *time.Time `json:"last_probe_at,omitempty"`
	LastProbeStatus string     `json:"last_probe_status,omitempty"`
	LastProbeError  string     `json:"last_probe_error,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type UpsertAssetConnectionProfileRequest struct {
	Protocol       string  `json:"protocol"`
	Host           string  `json:"host"`
	Port           int     `json:"port"`
	Username       string  `json:"username"`
	AuthType       string  `json:"auth_type"`
	Database       *string `json:"database"`
	Password       *string `json:"password"`
	PrivateKey     *string `json:"private_key"`
	Passphrase     *string `json:"passphrase"`
	BastionEnabled *bool   `json:"bastion_enabled"`
	ProxyID        *string `json:"proxy_id"`
}

type SSHProxy struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description,omitempty"`
	NetworkZone   string    `json:"network_zone,omitempty"`
	Host          string    `json:"host"`
	Port          int       `json:"port"`
	Username      string    `json:"username"`
	AuthType      string    `json:"auth_type"`
	HasPassword   bool      `json:"has_password"`
	HasPrivateKey bool      `json:"has_private_key"`
	HasPassphrase bool      `json:"has_passphrase"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type UpsertSSHProxyRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	NetworkZone string  `json:"network_zone"`
	Host        string  `json:"host"`
	Port        int     `json:"port"`
	Username    string  `json:"username"`
	AuthType    string  `json:"auth_type"`
	Password    *string `json:"password"`
	PrivateKey  *string `json:"private_key"`
	Passphrase  *string `json:"passphrase"`
}

type SSHProxyTarget struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	NetworkZone string `json:"network_zone"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	AuthType    string `json:"auth_type"`
	Password    string `json:"-"`
	PrivateKey  string `json:"-"`
	Passphrase  string `json:"-"`
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

type AssetRelation struct {
	ID           string `json:"id"`
	FromAssetID  string `json:"from_asset_id"`
	ToAssetID    string `json:"to_asset_id"`
	RelationType string `json:"relation_type"`
	Source       string `json:"source"`
	FromName     string `json:"from_name,omitempty"`
	FromType     string `json:"from_type,omitempty"`
	ToName       string `json:"to_name,omitempty"`
	ToType       string `json:"to_type,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type CreateRelationRequest struct {
	FromAssetID  string `json:"from_asset_id"`
	ToAssetID    string `json:"to_asset_id"`
	RelationType string `json:"relation_type"`
}

type BastionProbeTarget struct {
	AssetID    string          `json:"asset_id"`
	AssetName  string          `json:"asset_name"`
	AssetType  string          `json:"asset_type"`
	AssetEnv   string          `json:"asset_env"`
	KeyName    string          `json:"key_name,omitempty"`
	Protocol   string          `json:"protocol"`
	Host       string          `json:"host"`
	Port       int             `json:"port"`
	Username   string          `json:"username"`
	AuthType   string          `json:"auth_type"`
	Database   string          `json:"database,omitempty"`
	Password   string          `json:"password,omitempty"`
	PrivateKey string          `json:"private_key,omitempty"`
	Passphrase string          `json:"passphrase,omitempty"`
	Proxy      *SSHProxyTarget `json:"proxy,omitempty"`
}
