package keypair

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"

	"ops-platform/internal/security"
)

var (
	ErrKeypairNotFound = errors.New("keypair not found")
	ErrInvalidKey      = errors.New("invalid private key")
)

type Repository struct {
	db        *sql.DB
	masterKey string
}

func NewRepository(db *sql.DB, masterKey string) *Repository {
	return &Repository{db: db, masterKey: masterKey}
}

// Upsert inserts or overwrites a keypair identified by name. The private key
// is validated (and passphrase-decrypted if provided) before encryption so
// operators can't accidentally upload an unusable .pem.
func (r *Repository) Upsert(ctx context.Context, req UpsertRequest, uploadedBy string) (*Keypair, error) {
	if strings.TrimSpace(req.Name) == "" {
		return nil, errors.New("name is required")
	}
	if strings.TrimSpace(req.PrivateKey) == "" {
		return nil, errors.New("private_key is required")
	}

	passphrase := ""
	if req.Passphrase != nil {
		passphrase = *req.Passphrase
	}

	fingerprint, err := fingerprintPrivateKey(req.PrivateKey, passphrase)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidKey, err)
	}

	encKey, err := security.Encrypt(req.PrivateKey, r.masterKey)
	if err != nil {
		return nil, err
	}
	encPass, err := security.Encrypt(passphrase, r.masterKey)
	if err != nil {
		return nil, err
	}

	var kp Keypair
	var hasPass bool
	err = r.db.QueryRowContext(ctx, `
INSERT INTO ssh_keypair (name, fingerprint, private_key_encrypted, passphrase_encrypted, description, uploaded_by)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (name) DO UPDATE SET
    fingerprint = EXCLUDED.fingerprint,
    private_key_encrypted = EXCLUDED.private_key_encrypted,
    passphrase_encrypted = EXCLUDED.passphrase_encrypted,
    description = EXCLUDED.description,
    uploaded_by = EXCLUDED.uploaded_by,
    updated_at = now()
RETURNING id, name, fingerprint, description, (passphrase_encrypted != '') AS has_passphrase, uploaded_by, created_at, updated_at
`, req.Name, fingerprint, encKey, encPass, req.Description, uploadedBy).Scan(
		&kp.ID, &kp.Name, &kp.Fingerprint, &kp.Description, &hasPass, &kp.UploadedBy, &kp.CreatedAt, &kp.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	kp.HasPassphrase = hasPass
	return &kp, nil
}

func (r *Repository) List(ctx context.Context) ([]Keypair, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, name, fingerprint, description, (passphrase_encrypted != '') AS has_passphrase, uploaded_by, created_at, updated_at
FROM ssh_keypair
ORDER BY name
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var kps []Keypair
	for rows.Next() {
		var kp Keypair
		if err := rows.Scan(&kp.ID, &kp.Name, &kp.Fingerprint, &kp.Description, &kp.HasPassphrase, &kp.UploadedBy, &kp.CreatedAt, &kp.UpdatedAt); err != nil {
			return nil, err
		}
		kps = append(kps, kp)
	}
	return kps, rows.Err()
}

// GetSecretsByName returns the decrypted private key + passphrase for the
// named keypair. Used by the SSH/probe path to fill in missing per-asset creds.
func (r *Repository) GetSecretsByName(ctx context.Context, name string) (privateKey, passphrase string, err error) {
	var encKey, encPass string
	err = r.db.QueryRowContext(ctx, `
SELECT private_key_encrypted, passphrase_encrypted FROM ssh_keypair WHERE name = $1
`, name).Scan(&encKey, &encPass)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", ErrKeypairNotFound
		}
		return "", "", err
	}
	privateKey, err = security.Decrypt(encKey, r.masterKey)
	if err != nil {
		return "", "", err
	}
	passphrase, err = security.Decrypt(encPass, r.masterKey)
	return privateKey, passphrase, err
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM ssh_keypair WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrKeypairNotFound
	}
	return nil
}

func fingerprintPrivateKey(pem, passphrase string) (string, error) {
	var signer ssh.Signer
	var err error
	if passphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(pem), []byte(passphrase))
	} else {
		signer, err = ssh.ParsePrivateKey([]byte(pem))
	}
	if err != nil {
		return "", err
	}
	pub := signer.PublicKey()
	// Match AWS's style: MD5 colon-hex of the public key, plus SHA256 base64 for modern clients.
	md5sum := md5.Sum(pub.Marshal())
	sha := sha256.Sum256(pub.Marshal())
	md5hex := hex.EncodeToString(md5sum[:])
	parts := make([]string, 0, len(md5hex)/2)
	for i := 0; i < len(md5hex); i += 2 {
		parts = append(parts, md5hex[i:i+2])
	}
	return fmt.Sprintf("MD5:%s SHA256:%s", strings.Join(parts, ":"), base64.RawStdEncoding.EncodeToString(sha[:])), nil
}
