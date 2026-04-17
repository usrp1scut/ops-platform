package terminal

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

const (
	ticketTTL          = 60 * time.Second
	maxSessionsPerUser = 10
	idleTimeout        = 30 * time.Minute
)

type ticket struct {
	userID    string
	userName  string
	assetID   string
	expiresAt time.Time
}

type Service struct {
	mu       sync.Mutex
	tickets  map[string]ticket
	sessions map[string]int // userID -> active count
}

func NewService() *Service {
	s := &Service{
		tickets:  make(map[string]ticket),
		sessions: make(map[string]int),
	}
	go s.gcLoop()
	return s
}

func (s *Service) IssueTicket(userID, userName, assetID string) (string, time.Time, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", time.Time{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	expires := time.Now().Add(ticketTTL)
	s.mu.Lock()
	s.tickets[token] = ticket{userID: userID, userName: userName, assetID: assetID, expiresAt: expires}
	s.mu.Unlock()
	return token, expires, nil
}

// ConsumeTicket validates and removes a ticket. Returns the bound userID/assetID.
func (s *Service) ConsumeTicket(token string) (userID, userName, assetID string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tickets[token]
	if !ok {
		return "", "", "", errors.New("invalid ticket")
	}
	delete(s.tickets, token)
	if time.Now().After(t.expiresAt) {
		return "", "", "", errors.New("ticket expired")
	}
	return t.userID, t.userName, t.assetID, nil
}

// AcquireSession reserves a session slot; returns a release function.
func (s *Service) AcquireSession(userID string) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions[userID] >= maxSessionsPerUser {
		return nil, errors.New("max concurrent terminal sessions reached")
	}
	s.sessions[userID]++
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.sessions[userID] > 0 {
			s.sessions[userID]--
		}
	}, nil
}

func (s *Service) IdleTimeout() time.Duration { return idleTimeout }

func (s *Service) gcLoop() {
	ctx := context.Background()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.gcExpired()
		}
	}
}

func (s *Service) gcExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.tickets {
		if now.After(v.expiresAt) {
			delete(s.tickets, k)
		}
	}
}
