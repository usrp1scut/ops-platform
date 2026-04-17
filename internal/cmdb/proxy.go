package cmdb

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	"ops-platform/internal/security"
)

var ErrSSHProxyNotFound = errors.New("ssh proxy not found")

const sshProxyColumns = `
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

func scanSSHProxy(row interface {
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

func (r *Repository) ListSSHProxies(ctx context.Context) ([]SSHProxy, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT "+sshProxyColumns+" FROM cmdb_ssh_proxy WHERE deleted_at IS NULL ORDER BY network_zone, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]SSHProxy, 0)
	for rows.Next() {
		p, err := scanSSHProxy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetSSHProxy(ctx context.Context, id string) (SSHProxy, error) {
	row := r.db.QueryRowContext(ctx, "SELECT "+sshProxyColumns+" FROM cmdb_ssh_proxy WHERE id = $1::uuid AND deleted_at IS NULL", id)
	p, err := scanSSHProxy(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SSHProxy{}, ErrSSHProxyNotFound
		}
		return SSHProxy{}, err
	}
	return p, nil
}

func (r *Repository) CreateSSHProxy(ctx context.Context, req UpsertSSHProxyRequest, masterKey string) (SSHProxy, error) {
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
RETURNING `+sshProxyColumns,
		id, req.Name, req.Description, req.NetworkZone, req.Host, req.Port, req.Username, req.AuthType,
		encPass, encKey, encPhrase,
	)
	return scanSSHProxy(row)
}

func (r *Repository) UpdateSSHProxy(ctx context.Context, id string, req UpsertSSHProxyRequest, masterKey string) (SSHProxy, error) {
	if err := validateProxyRequest(&req); err != nil {
		return SSHProxy{}, err
	}
	// ensure exists
	if _, err := r.GetSSHProxy(ctx, id); err != nil {
		return SSHProxy{}, err
	}

	// only update secrets that were provided
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
		setParts = append(setParts, "password_encrypted = $"+itoa(idx))
		args = append(args, enc)
		idx++
	}
	if req.PrivateKey != nil {
		enc, err := security.Encrypt(*req.PrivateKey, masterKey)
		if err != nil {
			return SSHProxy{}, err
		}
		setParts = append(setParts, "private_key_encrypted = $"+itoa(idx))
		args = append(args, enc)
		idx++
	}
	if req.Passphrase != nil {
		enc, err := security.Encrypt(*req.Passphrase, masterKey)
		if err != nil {
			return SSHProxy{}, err
		}
		setParts = append(setParts, "passphrase_encrypted = $"+itoa(idx))
		args = append(args, enc)
		idx++
	}
	setParts = append(setParts, "updated_at = now()")

	query := "UPDATE cmdb_ssh_proxy SET " + strings.Join(setParts, ", ") + " WHERE id = $1::uuid AND deleted_at IS NULL RETURNING " + sshProxyColumns
	row := r.db.QueryRowContext(ctx, query, args...)
	return scanSSHProxy(row)
}

func (r *Repository) DeleteSSHProxy(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, "UPDATE cmdb_ssh_proxy SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL", id)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return ErrSSHProxyNotFound
	}
	return nil
}

// GetSSHProxyTarget loads decrypted proxy credentials for dialing.
func (r *Repository) GetSSHProxyTarget(ctx context.Context, id, masterKey string) (SSHProxyTarget, error) {
	var t SSHProxyTarget
	var encPass, encKey, encPhrase string
	err := r.db.QueryRowContext(ctx, `
SELECT id::text, name, COALESCE(network_zone, ''), host, port, username, auth_type,
    COALESCE(password_encrypted, ''), COALESCE(private_key_encrypted, ''), COALESCE(passphrase_encrypted, '')
FROM cmdb_ssh_proxy
WHERE id = $1::uuid AND deleted_at IS NULL
`, id).Scan(&t.ID, &t.Name, &t.NetworkZone, &t.Host, &t.Port, &t.Username, &t.AuthType, &encPass, &encKey, &encPhrase)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SSHProxyTarget{}, ErrSSHProxyNotFound
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

func itoa(i int) string {
	// small local helper to avoid importing strconv just for this file
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
