package sessions

import (
	"context"
	"log"
	"time"
)

// RecordingPurger deletes a stored recording object by key. Implemented by a
// storage adapter in the composition root so this package does not depend on
// the storage layer (same boundary as RecordingFetcher).
type RecordingPurger interface {
	RemoveObject(ctx context.Context, key string) error
}

// StartRecordingJanitor runs a background loop that purges recordings older
// than retention. Each tick deletes the storage object first and only clears
// the DB pointer when that succeeds, so a transient storage error simply
// retries on the next tick instead of orphaning a 404'd pointer. Retention is
// content-agnostic: it covers both SSH casts and RDP Guacamole recordings.
//
// The loop exits when ctx is cancelled. retention<=0 or a nil purger disables
// it (no goroutine started), preserving the prior keep-forever behavior.
func StartRecordingJanitor(ctx context.Context, repo *Repository, purger RecordingPurger, retention time.Duration, interval time.Duration) {
	if repo == nil || purger == nil || retention <= 0 {
		return
	}
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	logger := log.New(log.Writer(), "recording-gc ", log.LstdFlags)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		runRecordingGC(ctx, repo, purger, retention, logger)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runRecordingGC(ctx, repo, purger, retention, logger)
			}
		}
	}()
}

func runRecordingGC(ctx context.Context, repo *Repository, purger RecordingPurger, retention time.Duration, logger *log.Logger) {
	cutoff := time.Now().Add(-retention)
	expired, err := repo.ExpiredRecordings(ctx, cutoff, 500)
	if err != nil {
		logger.Printf("list expired recordings failed: %v", err)
		return
	}
	purged := 0
	for _, rec := range expired {
		if ctx.Err() != nil {
			return
		}
		if err := purger.RemoveObject(ctx, rec.URI); err != nil {
			logger.Printf("purge object failed: session=%s key=%s err=%v", rec.SessionID, rec.URI, err)
			continue
		}
		if err := repo.ClearRecording(ctx, rec.SessionID); err != nil {
			logger.Printf("clear recording pointer failed: session=%s err=%v", rec.SessionID, err)
			continue
		}
		purged++
	}
	if purged > 0 {
		logger.Printf("purged %d recording(s) older than %s", purged, cutoff.Format(time.RFC3339))
	}
}
