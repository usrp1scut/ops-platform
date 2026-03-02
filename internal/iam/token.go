package iam

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type TokenService struct {
	signingKey []byte
}

func NewTokenService(signingKey string) *TokenService {
	return &TokenService{signingKey: []byte(signingKey)}
}

func (s *TokenService) Issue(identity UserIdentity, ttl time.Duration) (string, error) {
	now := time.Now().Unix()
	claims := TokenClaims{
		UserID:      identity.User.ID,
		Subject:     identity.User.OIDCSubject,
		Roles:       identity.Roles,
		Permissions: identity.Permissions,
		ExpiresAt:   now + int64(ttl.Seconds()),
		IssuedAt:    now,
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := s.sign(encodedPayload)
	return encodedPayload + "." + signature, nil
}

func (s *TokenService) Parse(token string) (TokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return TokenClaims{}, errors.New("invalid token format")
	}

	expected := s.sign(parts[0])
	if !hmac.Equal([]byte(parts[1]), []byte(expected)) {
		return TokenClaims{}, errors.New("invalid token signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenClaims{}, fmt.Errorf("decode payload: %w", err)
	}

	var claims TokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return TokenClaims{}, fmt.Errorf("parse payload: %w", err)
	}
	if claims.ExpiresAt <= time.Now().Unix() {
		return TokenClaims{}, errors.New("token expired")
	}
	if claims.UserID == "" || claims.Subject == "" {
		return TokenClaims{}, errors.New("invalid token claims")
	}

	return claims, nil
}

func (s *TokenService) sign(payload string) string {
	mac := hmac.New(sha256.New, s.signingKey)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
