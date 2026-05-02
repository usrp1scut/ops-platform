package terminal

import (
	"errors"
	"sync"
	"time"
)

const (
	maxSessionsPerUser = 10
	idleTimeout        = 30 * time.Minute
)

// Service tracks per-user concurrent terminal sessions. Ticket lifecycle is
// owned by internal/connectivity.TicketService.
type Service struct {
	mu       sync.Mutex
	sessions map[string]int // userID -> active count
}

func NewService() *Service {
	return &Service{
		sessions: make(map[string]int),
	}
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
