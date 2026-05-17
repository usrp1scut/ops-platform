package guacproxy

import (
	"os"
	"sync"
)

// Recorder appends the raw guacd→browser (server→client) Guacamole
// instruction stream to a file while an RDP session runs. The file is a
// Guacamole session recording: the byte-identical server-to-client protocol
// stream, with no extra framing. Playback timing is derived by the client
// from the embedded "sync" instructions, so nothing else needs to be stored.
//
// We deliberately record ONLY the server→client direction — never
// client→server. Inbound frames carry keyboard, clipboard, and drag data
// that may include typed credentials; recording only what the operator saw
// is the right tradeoff for audit, and matches the SSH cast recorder.
//
// The Recorder is goroutine-safe. A nil *Recorder is a safe no-op on every
// method so the bridge can use one code path regardless of whether recording
// is enabled.
type Recorder struct {
	mu        sync.Mutex
	f         *os.File
	closed    bool
	maxBytes  int64 // 0 = unlimited
	written   int64
	truncated bool
}

// NewRecorder opens path for write, truncating any existing file. maxBytes
// caps the recording (0 = unlimited); once the cap would be exceeded, capture
// stops at the last whole instruction so the file stays a valid prefix of the
// server→client stream and remains playable. The caller MUST call Close even
// on error paths so the file handle is released.
func NewRecorder(path string, maxBytes int64) (*Recorder, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	return &Recorder{f: f, maxBytes: maxBytes}, nil
}

// Write appends one already-encoded server→client instruction (the exact
// bytes forwarded to the browser) to the recording. nil receiver / empty
// payload is a safe no-op. Writes are all-or-nothing per instruction: an
// instruction that would cross maxBytes is dropped whole and all subsequent
// writes are skipped, keeping the file parseable by the playback client.
func (r *Recorder) Write(payload []byte) error {
	if r == nil || len(payload) == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.truncated {
		return nil
	}
	if r.maxBytes > 0 && r.written+int64(len(payload)) > r.maxBytes {
		r.truncated = true
		return nil
	}
	n, err := r.f.Write(payload)
	r.written += int64(n)
	return err
}

// Truncated reports whether the size cap stopped capture before the session
// ended. Used by the handler to log a clear audit-quality warning without a
// schema change.
func (r *Recorder) Truncated() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.truncated
}

// Close flushes and closes the underlying file, returning the byte size on
// disk. Idempotent; subsequent calls return (0, nil).
func (r *Recorder) Close() (int64, error) {
	if r == nil {
		return 0, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, nil
	}
	r.closed = true
	info, statErr := r.f.Stat()
	closeErr := r.f.Close()
	switch {
	case statErr != nil:
		return 0, statErr
	case closeErr != nil:
		return info.Size(), closeErr
	}
	return info.Size(), nil
}

// Path returns the file path for upload after Close.
func (r *Recorder) Path() string {
	if r == nil {
		return ""
	}
	return r.f.Name()
}
