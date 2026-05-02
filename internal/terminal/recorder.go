package terminal

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// Recorder writes an asciinema cast v2 file to disk while a session runs.
// Format spec: https://docs.asciinema.org/manual/asciicast/v2/
//
//	line 1:  {"version":2,"width":W,"height":H,"timestamp":T,"env":{...}}
//	line N:  [seconds_since_start, "o", data]   ← we only record output
//
// We deliberately do NOT record input ("i" frames). Typed input may contain
// passwords (sudo prompts, leaked from shell history, etc.). Recording only
// what the user saw is the right tradeoff for review/audit.
//
// The Recorder is goroutine-safe; the SSH stdout/stderr pumps in handler.go
// run concurrently and both call WriteOutput.
type Recorder struct {
	mu      sync.Mutex
	f       *os.File
	started time.Time
	closed  bool
	cols    int
	rows    int
}

// NewRecorder opens path for write, emits the cast v2 header, and returns
// a Recorder ready for WriteOutput calls. Caller MUST call Close even on
// error paths so the file handle is released.
func NewRecorder(path string, cols, rows int) (*Recorder, error) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	header := map[string]any{
		"version":   2,
		"width":     cols,
		"height":    rows,
		"timestamp": time.Now().Unix(),
		"env": map[string]string{
			"TERM":  "xterm-256color",
			"SHELL": "/bin/sh",
		},
	}
	enc := json.NewEncoder(f)
	if err := enc.Encode(header); err != nil {
		f.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return &Recorder{f: f, started: time.Now(), cols: cols, rows: rows}, nil
}

// WriteOutput appends an "o"-type frame timestamped against the recorder's
// start. nil receiver is a safe no-op so callers can use a single code path
// regardless of whether recording is enabled.
func (r *Recorder) WriteOutput(data []byte) error {
	if r == nil || len(data) == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	frame := []any{time.Since(r.started).Seconds(), "o", string(data)}
	buf, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	buf = append(buf, '\n')
	_, err = r.f.Write(buf)
	return err
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
