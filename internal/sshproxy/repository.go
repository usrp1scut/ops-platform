package sshproxy

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"ops-platform/internal/security"
)

// Columns is the canonical SELECT list for cmdb_ssh_proxy. Exported so
// cmdb's cross-aggregate Tx helpers (vpcproxy.go) can reuse it without
// duplicating the row shape — the only legitimate caller outside this
// package.
const Columns = `
id::text,
name,
COALESCE(description, ''),
COALESCE(network_zone, ''),
host,
port,
username,
auth_type,
CASE WHEN COALESCE(password_encrypted, '') <> '' THEN true ELSE false END,
CASE WHEN COALESCE(private_key_encrypted, '') <> '' THEN true ELSE false END,
CASE WHEN COALESCE(passphrase_encrypted, '') <> '' THEN true ELSE false END,
created_at,
updated_at`

// Scan reads a row produced by a SELECT against Columns into an SSHProxy.
// Exported for the same reason as Columns.
func Scan(row interface {
	Scan(dest ...any) error
}) (SSHProxy, error) {
	return scanProxy(row)
}

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) DB() *sql.DB { return r.db }

func scanProxy(row interface {
	Scan(dest ...any) error
}) (SSHProxy, error) {
	var p SSHProxy
	if err := row.Scan(
		&p.ID,
		&p.Name,
		&p.Description,
		&p.NetworkZone,
		&p.Host,
		&p.Port,
		&p.Username,
		&p.AuthType,
		&p.HasPassword,
		&p.HasPrivateKey,
		&p.HasPassphrase,
		&p.CreatedAt,
		&p.UpdatedAt,
	); err != nil {
		return SSHProxy{}, err
	}
	return p, nil
}

func (r *Repository) List(ctx context.Context) ([]SSHProxy, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT "+Columns+" FROM cmdb_ssh_proxy WHERE deleted_at IS NULL ORDER BY network_zone, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]SSHProxy, 0)
	for rows.Next() {
		p, err := scanProxy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) Get(ctx context.Context, id string) (SSHProxy, error) {
	row := r.db.QueryRowContext(ctx, "SELECT "+Columns+" FROM cmdb_ssh_proxy WHERE id = $1::uuid AND deleted_at IS NULL", id)
	p, err := scanProxy(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SSHProxy{}, ErrNotFound
		}
		return SSHProxy{}, err
	}
	return p, nil
}

func (r *Repository) Create(ctx context.Context, req UpsertSSHProxyRequest, masterKey string) (SSHProxy, error) {
	if err := validateProxyRequest(&req); err != nil {
		return SSHProxy{}, err
	}
	id := uuid.NewString()

	password := ""
	if req.Password != nil {
		password = *req.Password
	}
	privateKey := ""
	if req.PrivateKey != nil {
		privateKey = *req.PrivateKey
	}
	passphrase := ""
	if req.Passphrase != nil {
		passphrase = *req.Passphrase
	}

	encPass, err := security.Encrypt(password, masterKey)
	if err != nil {
		return SSHProxy{}, err
	}
	encKey, err := security.Encrypt(privateKey, masterKey)
	if err != nil {
		return SSHProxy{}, err
	}
	encPhrase, err := security.Encrypt(passphrase, masterKey)
	if err != nil {
		return SSHProxy{}, err
	}

	row := r.db.QueryRowContext(ctx, `
INSERT INTO cmdb_ssh_proxy (
    id, name, description, network_zone, host, port, username, auth_type,
    password_encrypted, private_key_encrypted, passphrase_encrypted
) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING `+Columns,
		id, req.Name, req.Description, req.NetworkZone, req.Host, req.Port, req.Username, req.AuthType,
		encPass, encKey, encPhrase,
	)
	return scanProxy(row)
}

func (r *Repository) Update(ctx context.Context, id string, req UpsertSSHProxyRequest, masterKey string) (SSHProxy, error) {
	if err := validateProxyRequest(&req); err != nil {
		return SSHProxy{}, err
	}
	if _, err := r.Get(ctx, id); err != nil {
		return SSHProxy{}, err
	}

	args := []any{id, req.Name, req.Description, req.NetworkZone, req.Host, req.Port, req.Username, req.AuthType}
	setParts := []string{
		"name = $2",
		"description = $3",
		"network_zone = $4",
		"host = $5",
		"port = $6",
		"username = $7",
		"auth_type = $8",
	}
	idx := 9
	if req.Password != nil {
		enc, err := security.Encrypt(*req.Password, masterKey)
		if err != nil {
			return SSHProxy{}, err
		}
		setParts = append(setParts, "password_encrypted = $"+strconv.Itoa(idx))
		args = append(args, enc)
		idx++
	}
	if req.PrivateKey != nil {
		enc, err := security.Encrypt(*req.PrivateKey, masterKey)
		if err != nil {
			return SSHProxy{}, err
		}
		setParts = append(setParts, "private_key_encrypted = $"+strconv.Itoa(idx))
		args = append(args, enc)
		idx++
	}
	if req.Passphrase != nil {
		enc, err := security.Encrypt(*req.Passphrase, masterKey)
		if err != nil {
			return SSHProxy{}, err
		}
		setParts = append(setParts, "passphrase_encrypted = $"+strconv.Itoa(idx))
		args = append(args, enc)
		idx++
	}
	setParts = append(setParts, "updated_at = now()")

	query := "UPDATE cmdb_ssh_proxy SET " + strings.Join(setParts, ", ") + " WHERE id = $1::uuid AND deleted_at IS NULL RETURNING " + Columns
	row := r.db.QueryRowContext(ctx, query, args...)
	return scanProxy(row)
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, "UPDATE cmdb_ssh_proxy SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL", id)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return ErrNotFound
	}
	return nil
}

// GetTarget loads a proxy with decrypted credentials so bastionprobe can dial
// it. The masterKey arg keeps decryption out of the repo's startup config and
// makes test wiring obvious.
func (r *Repository) GetTarget(ctx context.Context, id, masterKey string) (SSHProxyTarget, error) {
	var t SSHProxyTarget
	var encPass, encKey, encPhrase string
	err := r.db.QueryRowContext(ctx, `
SELECT id::text, name, COALESCE(network_zone, ''), host, port, username, auth_type,
    COALESCE(key_name, ''),
    COALESCE(password_encrypted, ''), COALESCE(private_key_encrypted, ''), COALESCE(passphrase_encrypted, '')
FROM cmdb_ssh_proxy
WHERE id = $1::uuid AND deleted_at IS NULL
`, id).Scan(&t.ID, &t.Name, &t.NetworkZone, &t.Host, &t.Port, &t.Username, &t.AuthType, &t.KeyName, &encPass, &encKey, &encPhrase)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SSHProxyTarget{}, ErrNotFound
		}
		return SSHProxyTarget{}, err
	}
	if encPass != "" {
		dec, err := security.Decrypt(encPass, masterKey)
		if err != nil {
			return SSHProxyTarget{}, err
		}
		t.Password = dec
	}
	if encKey != "" {
		dec, err := security.Decrypt(encKey, masterKey)
		if err != nil {
			return SSHProxyTarget{}, err
		}
		t.PrivateKey = dec
	}
	if encPhrase != "" {
		dec, err := security.Decrypt(encPhrase, masterKey)
		if err != nil {
			return SSHProxyTarget{}, err
		}
		t.Passphrase = dec
	}
	return t, nil
}

func validateProxyRequest(req *UpsertSSHProxyRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Host = strings.TrimSpace(req.Host)
	req.Username = strings.TrimSpace(req.Username)
	req.AuthType = strings.ToLower(strings.TrimSpace(req.AuthType))
	if req.Name == "" {
		return errors.New("name is required")
	}
	if req.Host == "" {
		return errors.New("host is required")
	}
	if req.Username == "" {
		return errors.New("username is required")
	}
	if req.Port <= 0 {
		req.Port = 22
	}
	if req.AuthType == "" {
		req.AuthType = "password"
	}
	if req.AuthType != "password" && req.AuthType != "key" {
		return errors.New("auth_type must be password or key")
	}
	return nil
}
