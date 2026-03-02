package awssync

import (
	"context"
	"sync"
	"time"
)

type RunnerStatus struct {
	Running        bool       `json:"running"`
	LastStartedAt  *time.Time `json:"last_started_at,omitempty"`
	LastFinishedAt *time.Time `json:"last_finished_at,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
}

type Runner struct {
	service *Service

	mu           sync.Mutex
	running      bool
	lastStarted  time.Time
	lastFinished time.Time
	lastError    string
}

func NewRunner(service *Service) *Runner {
	return &Runner{service: service}
}

func (r *Runner) Trigger() bool {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return false
	}
	r.running = true
	r.lastStarted = time.Now()
	r.mu.Unlock()

	go func() {
		err := r.service.RunOnce(context.Background())

		r.mu.Lock()
		defer r.mu.Unlock()
		r.running = false
		r.lastFinished = time.Now()
		if err != nil {
			r.lastError = err.Error()
		} else {
			r.lastError = ""
		}
	}()

	return true
}

func (r *Runner) Status() RunnerStatus {
	r.mu.Lock()
	defer r.mu.Unlock()

	var lastStartedAt *time.Time
	if !r.lastStarted.IsZero() {
		t := r.lastStarted
		lastStartedAt = &t
	}
	var lastFinishedAt *time.Time
	if !r.lastFinished.IsZero() {
		t := r.lastFinished
		lastFinishedAt = &t
	}

	return RunnerStatus{
		Running:        r.running,
		LastStartedAt:  lastStartedAt,
		LastFinishedAt: lastFinishedAt,
		LastError:      r.lastError,
	}
}
