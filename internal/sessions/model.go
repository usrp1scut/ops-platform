package sessions

import "time"

type Session struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	UserName   string     `json:"user_name"`
	AssetID    string     `json:"asset_id"`
	AssetName  string     `json:"asset_name"`
	ProxyID    string     `json:"proxy_id,omitempty"`
	ProxyName  string     `json:"proxy_name,omitempty"`
	ClientIP   string     `json:"client_ip,omitempty"`
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at,omitempty"`
	ExitCode   *int       `json:"exit_code,omitempty"`
	BytesIn    int64      `json:"bytes_in"`
	BytesOut   int64      `json:"bytes_out"`
	ErrorMsg   string     `json:"error,omitempty"`
	DurationMs int64      `json:"duration_ms,omitempty"`
	// HasRecording is true when an asciinema cast is stored for this
	// session. The recording bytes are served via /recording — never
	// exposed as a URL field, since the storage URI is server-side.
	HasRecording   bool  `json:"has_recording"`
	RecordingBytes int64 `json:"recording_bytes,omitempty"`
}

type ListQuery struct {
	UserID  string
	AssetID string
	Limit   int
	Offset  int
}
