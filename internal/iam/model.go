package iam

import "time"

type User struct {
	ID          string    `json:"id"`
	OIDCSubject string    `json:"oidc_subject"`
	Email       string    `json:"email,omitempty"`
	Name        string    `json:"name,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	LastLoginAt time.Time `json:"last_login_at"`
}

type UserProfile struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
}

type UserIdentity struct {
	User        User     `json:"user"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
}

type TokenClaims struct {
	UserID      string   `json:"uid"`
	Subject     string   `json:"sub"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"perms"`
	ExpiresAt   int64    `json:"exp"`
	IssuedAt    int64    `json:"iat"`
}
