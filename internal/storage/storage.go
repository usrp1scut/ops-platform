// Package storage is a thin S3-compatible blob store wrapper used by the
// platform for terminal session recordings (asciinema casts) and any other
// large opaque artifact a feature wants to persist.
//
// It is deliberately small: PutObject + GetObject + Stat. We do not add
// presigned URLs, multi-part upload, or per-object ACLs until a feature
// actually needs them — a recurring source of mocks-that-pretend-to-test
// nothing in v1 codebases.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"ops-platform/internal/config"
)

// ErrNoStorage signals that recording (or any other storage-backed feature)
// is not configured. Callers should treat the artifact as optional.
var ErrNoStorage = errors.New("recording storage not configured")

// Object describes a stored artifact. Size is in bytes; ContentType is the
// hint we wrote at upload time (caller-provided).
type Object struct {
	Key         string
	Size        int64
	ContentType string
}

// Client wraps minio-go and remembers the bucket. nil means storage is not
// configured; callers must check IsEnabled before using methods.
type Client struct {
	cli    *minio.Client
	bucket string
}

func NewClient(cfg config.Config) (*Client, error) {
	if !cfg.RecordingEnabled {
		return nil, ErrNoStorage
	}
	mc, err := minio.New(cfg.RecordingEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.RecordingAccessID, cfg.RecordingSecret, ""),
		Secure: cfg.RecordingUseSSL,
		Region: cfg.RecordingRegion,
	})
	if err != nil {
		return nil, fmt.Errorf("init minio client: %w", err)
	}
	c := &Client{cli: mc, bucket: cfg.RecordingBucket}
	if err := c.ensureBucket(context.Background()); err != nil {
		return nil, err
	}
	return c, nil
}

// IsEnabled reports whether storage is wired. nil-safe so callers can short
// circuit without holding a live config reference.
func (c *Client) IsEnabled() bool { return c != nil && c.cli != nil }

func (c *Client) ensureBucket(ctx context.Context) error {
	exists, err := c.cli.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists probe: %w", err)
	}
	if !exists {
		if err := c.cli.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("make bucket %s: %w", c.bucket, err)
		}
	}
	return nil
}

// PutObject uploads body of known size. We require size up front because
// asciinema recordings are flushed to a temp file before upload; streaming
// uploads of unknown size would force chunked PUTs we don't need yet.
func (c *Client) PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) (Object, error) {
	if !c.IsEnabled() {
		return Object{}, ErrNoStorage
	}
	info, err := c.cli.PutObject(ctx, c.bucket, key, body, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return Object{}, fmt.Errorf("put %s: %w", key, err)
	}
	return Object{Key: key, Size: info.Size, ContentType: contentType}, nil
}

// GetObject returns a reader the caller MUST close. The size and content type
// come from the stored metadata, not from the cfg defaults.
func (c *Client) GetObject(ctx context.Context, key string) (io.ReadCloser, Object, error) {
	if !c.IsEnabled() {
		return nil, Object{}, ErrNoStorage
	}
	obj, err := c.cli.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, Object{}, fmt.Errorf("get %s: %w", key, err)
	}
	stat, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, Object{}, fmt.Errorf("stat %s: %w", key, err)
	}
	return obj, Object{Key: key, Size: stat.Size, ContentType: stat.ContentType}, nil
}
