package keypair

import "time"

type Keypair struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Fingerprint   string    `json:"fingerprint"`
	Description   string    `json:"description,omitempty"`
	HasPassphrase bool      `json:"has_passphrase"`
	UploadedBy    string    `json:"uploaded_by,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type UpsertRequest struct {
	Name        string  `json:"name"`
	PrivateKey  string  `json:"private_key"`
	Passphrase  *string `json:"passphrase"`
	Description string  `json:"description"`
}
