package sessions

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

type StartInput struct {
	UserID    string
	UserName  string
	AssetID   string
	AssetName string
	ProxyID   string
	ProxyName string
	ClientIP  string
}

func (r *Repository) Start(ctx context.Context, in StartInput) (string, error) {
	id := uuid.NewString()
	var proxyID any
	if strings.TrimSpace(in.ProxyID) != "" {
		proxyID = in.ProxyID
	}
	_, err := r.db.ExecContext(ctx, `
INSERT INTO terminal_session
    (id, user_id, user_name, asset_id, asset_name, proxy_id, proxy_name, client_ip, started_at)
VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6::uuid, $7, $8, now())`,
		id, in.UserID, in.UserName, in.AssetID, in.AssetName, proxyID, in.ProxyName, in.ClientIP)
	if err != nil {
		return "", err
	}
	return id, nil
}

type EndInput struct {
	SessionID string
	ExitCode  *int
	BytesIn   int64
	BytesOut  int64
	Error     string
}

func (r *Repository) End(ctx context.Context, in EndInput) error {
	var exit any
	if in.ExitCode != nil {
		exit = *in.ExitCode
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE terminal_session
   SET ended_at = now(),
       exit_code = $2,
       bytes_in = $3,
       bytes_out = $4,
       error_msg = $5
 WHERE id = $1::uuid`, in.SessionID, exit, in.BytesIn, in.BytesOut, in.Error)
	return err
}

func (r *Repository) List(ctx context.Context, q ListQuery) ([]Session, error) {
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1=1"}
	args := []any{}
	idx := 1
	if strings.TrimSpace(q.UserID) != "" {
		where = append(where, "user_id = $"+itoa(idx))
		args = append(args, q.UserID)
		idx++
	}
	if strings.TrimSpace(q.AssetID) != "" {
		where = append(where, "asset_id = $"+itoa(idx)+"::uuid")
		args = append(args, q.AssetID)
		idx++
	}
	args = append(args, limit, q.Offset)
	query := `
SELECT id::text, user_id, COALESCE(user_name, ''), asset_id::text, COALESCE(asset_name, ''),
       COALESCE(proxy_id::text, ''), COALESCE(proxy_name, ''),
       COALESCE(client_ip, ''), started_at, ended_at, exit_code, bytes_in, bytes_out, COALESCE(error_msg, '')
  FROM terminal_session
 WHERE ` + strings.Join(where, " AND ") + `
 ORDER BY started_at DESC
 LIMIT $` + itoa(idx) + ` OFFSET $` + itoa(idx+1)
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Session, 0)
	for rows.Next() {
		var s Session
		var endedAt sql.NullTime
		var exitCode sql.NullInt32
		if err := rows.Scan(&s.ID, &s.UserID, &s.UserName, &s.AssetID, &s.AssetName,
			&s.ProxyID, &s.ProxyName, &s.ClientIP, &s.StartedAt, &endedAt, &exitCode,
			&s.BytesIn, &s.BytesOut, &s.ErrorMsg); err != nil {
			return nil, err
		}
		if endedAt.Valid {
			t := endedAt.Time
			s.EndedAt = &t
			s.DurationMs = t.Sub(s.StartedAt).Milliseconds()
		} else {
			s.DurationMs = time.Since(s.StartedAt).Milliseconds()
		}
		if exitCode.Valid {
			v := int(exitCode.Int32)
			s.ExitCode = &v
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func itoa(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	buf := make([]byte, 0, 4)
	for i > 0 {
		buf = append([]byte{digits[i%10]}, buf...)
		i /= 10
	}
	return string(buf)
}
