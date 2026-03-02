package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

func Encrypt(plaintext, key string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	k := []byte(key)
	if len(k) != 32 {
		return "", errors.New("master key must be 32 bytes")
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func Decrypt(ciphertextBase64, key string) (string, error) {
	if ciphertextBase64 == "" {
		return "", nil
	}
	k := []byte(key)
	if len(k) != 32 {
		return "", errors.New("master key must be 32 bytes")
	}

	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextBase64)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("ciphertext is too short")
	}

	nonce := ciphertext[:gcm.NonceSize()]
	payload := ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}
	return string(plaintext), nil
}
