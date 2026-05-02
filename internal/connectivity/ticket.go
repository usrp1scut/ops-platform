// Package connectivity owns the cross-protocol session entry points for SSH
// terminal and RDP/Guacamole. It centralises ticketing so that protocol
// handlers do not each maintain their own short-lived token store.
package connectivity

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

// DefaultTicketTTL is the lifetime of a ticket from issue to first consume.
const DefaultTicketTTL = 60 * time.Second

// ErrInvalidTicket is returned when a token is unknown.
var ErrInvalidTicket = errors.New("invalid ticket")

// ErrTicketExpired is returned when a token was found but had expired.
var ErrTicketExpired = errors.New("ticket expired")

// Ticket is the bound context returned by ConsumeTicket.
type Ticket struct {
	UserID   string
	UserName string
	AssetID  string
}

// TicketService issues and consumes short-lived single-use tokens that bind a
// user identity to a specific asset. Both the SSH terminal and the
// RDP/Guacamole bridge share a single instance so that limits, lifetimes and
// audit semantics are uniform.
type TicketService struct {
	ttl time.Duration

	mu      sync.Mutex
	tickets map[string]ticketEntry

	stop chan struct{}
}

type ticketEntry struct {
	userID    string
	userName  string
	assetID   string
	expiresAt time.Time
}

// NewTicketService starts a background GC loop that runs until ctx is cancelled.
// Pass ttl<=0 to use DefaultTicketTTL.
func NewTicketService(ctx context.Context, ttl time.Duration) *TicketService {
	if ttl <= 0 {
		ttl = DefaultTicketTTL
	}
	s := &TicketService{
		ttl:     ttl,
		tickets: make(map[string]ticketEntry),
		stop:    make(chan struct{}),
	}
	go s.gcLoop(ctx)
	return s
}

// IssueTicket creates a new token bound to (userID, userName, assetID).
func (s *TicketService) IssueTicket(userID, userName, assetID string) (token string, expiresAt time.Time, err error) {
	buf := make([]byte, 24)
	if _, err = rand.Read(buf); err != nil {
		return "", time.Time{}, err
	}
	token = base64.RawURLEncoding.EncodeToString(buf)
	expiresAt = time.Now().Add(s.ttl)
	s.mu.Lock()
	s.tickets[token] = ticketEntry{
		userID:    userID,
		userName:  userName,
		assetID:   assetID,
		expiresAt: expiresAt,
	}
	s.mu.Unlock()
	return token, expiresAt, nil
}

// ConsumeTicket validates and removes a ticket. The token is single-use.
func (s *TicketService) ConsumeTicket(token string) (Ticket, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tickets[token]
	if !ok {
		return Ticket{}, ErrInvalidTicket
	}
	delete(s.tickets, token)
	if time.Now().After(t.expiresAt) {
		return Ticket{}, ErrTicketExpired
	}
	return Ticket{UserID: t.userID, UserName: t.userName, AssetID: t.assetID}, nil
}

func (s *TicketService) gcLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stop:
			return
		case <-ticker.C:
			s.gc()
		}
	}
}

func (s *TicketService) gc() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.tickets {
		if now.After(v.expiresAt) {
			delete(s.tickets, k)
		}
	}
}
