package httpserver

import (
	"context"
	"io"

	"ops-platform/internal/sessions"
	"ops-platform/internal/storage"
)

// recordingFetcher adapts storage.Client to sessions.RecordingFetcher. Kept
// in the composition root so neither sessions nor storage has to depend on
// the other.
type recordingFetcher struct {
	store *storage.Client
}

func (f recordingFetcher) GetObject(ctx context.Context, key string) (io.ReadCloser, sessions.RecordingObject, error) {
	body, obj, err := f.store.GetObject(ctx, key)
	if err != nil {
		return nil, sessions.RecordingObject{}, err
	}
	return body, sessions.RecordingObject{Key: obj.Key, Size: obj.Size, ContentType: obj.ContentType}, nil
}
