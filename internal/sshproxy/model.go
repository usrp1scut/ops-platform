// Package sshproxy owns the SSH bastion / VPC-proxy aggregate: its database
// rows (cmdb_ssh_proxy), the HTTP CRUD endpoints under /api/v1/cmdb/ssh-proxies,
// and the dialer-friendly target representation used by bastionprobe.
//
// The package was extracted from internal/cmdb during the cmdb decomposition
// (post-Phase 5) so that the proxy domain has a single home and cmdb's
// remaining responsibility (asset/connection/probe) is no longer "everything
// adjacent to a host".
package sshproxy

import (
	"errors"
	"time"
)

// ErrNotFound is returned when a proxy ID lookup misses or the row is
// soft-deleted. Kept as a typed error so handlers can map it to 404.
var ErrNotFound = errors.New("ssh proxy not found")

// Deprecated: alias preserved for the brief overlap window where callers
// migrate off the old name. Remove in the next release.
var ErrSSHProxyNotFound = ErrNotFound

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

// SSHProxyTarget is the dialer-friendly view: decrypted credentials and the
// fields the SSH client needs. bastionprobe consumes this directly. The
// Password/PrivateKey/Passphrase fields are intentionally hidden from JSON
// because this struct is not meant to leave the binary.
type SSHProxyTarget struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	NetworkZone string `json:"network_zone"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	AuthType    string `json:"auth_type"`
	KeyName     string `json:"key_name,omitempty"`
	Password    string `json:"-"`
	PrivateKey  string `json:"-"`
	Passphrase  string `json:"-"`
}
