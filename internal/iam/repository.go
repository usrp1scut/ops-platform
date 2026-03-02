package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"strings"

	"github.com/google/uuid"
)

var ErrUserNotFound = errors.New("user not found")

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) UpsertUser(ctx context.Context, profile UserProfile) (User, error) {
	id := uuid.NewString()

	var user User
	query := `
INSERT INTO iam_user (id, oidc_subject, email, name, last_login_at)
VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), now())
ON CONFLICT (oidc_subject)
DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now(), updated_at = now()
RETURNING id, oidc_subject, COALESCE(email, ''), COALESCE(name, ''), created_at, updated_at, COALESCE(last_login_at, now())`
	err := r.db.QueryRowContext(ctx, query, id, profile.Subject, profile.Email, profile.Name).Scan(
		&user.ID,
		&user.OIDCSubject,
		&user.Email,
		&user.Name,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.LastLoginAt,
	)
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (r *Repository) EnsureAdminBinding(ctx context.Context, userID string, bootstrapSubjects []string, userSubject string) error {
	var hasAnyBinding bool
	err := r.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM iam_user_role_binding)").Scan(&hasAnyBinding)
	if err != nil {
		return err
	}

	allowBootstrap := !hasAnyBinding
	if !allowBootstrap && len(bootstrapSubjects) > 0 {
		for _, subject := range bootstrapSubjects {
			if strings.TrimSpace(subject) == userSubject {
				allowBootstrap = true
				break
			}
		}
	}
	if !allowBootstrap {
		return nil
	}

	_, err = r.db.ExecContext(ctx, `
INSERT INTO iam_user_role_binding (id, user_id, role_id)
SELECT $1, $2, r.id
FROM iam_role r
WHERE r.name = 'admin'
ON CONFLICT (user_id, role_id) DO NOTHING
`, uuid.NewString(), userID)
	return err
}

func (r *Repository) IdentityForUser(ctx context.Context, userID string) (UserIdentity, error) {
	var user User
	err := r.db.QueryRowContext(ctx, `
SELECT id, oidc_subject, COALESCE(email, ''), COALESCE(name, ''), created_at, updated_at, COALESCE(last_login_at, now())
FROM iam_user WHERE id = $1
`, userID).Scan(
		&user.ID,
		&user.OIDCSubject,
		&user.Email,
		&user.Name,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.LastLoginAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return UserIdentity{}, ErrUserNotFound
		}
		return UserIdentity{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT r.name, rp.resource, rp.action
FROM iam_user_role_binding b
JOIN iam_role r ON r.id = b.role_id
LEFT JOIN iam_role_permission rp ON rp.role_id = r.id
WHERE b.user_id = $1
ORDER BY r.name ASC
`, userID)
	if err != nil {
		return UserIdentity{}, err
	}
	defer rows.Close()

	roleSet := map[string]struct{}{}
	permSet := map[string]struct{}{}
	for rows.Next() {
		var role string
		var resource sql.NullString
		var action sql.NullString
		if err := rows.Scan(&role, &resource, &action); err != nil {
			return UserIdentity{}, err
		}
		roleSet[role] = struct{}{}
		if resource.Valid && action.Valid {
			permSet[resource.String+":"+action.String] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return UserIdentity{}, err
	}

	roles := make([]string, 0, len(roleSet))
	for role := range roleSet {
		roles = append(roles, role)
	}
	perms := make([]string, 0, len(permSet))
	for perm := range permSet {
		perms = append(perms, perm)
	}

	return UserIdentity{
		User:        user,
		Roles:       roles,
		Permissions: perms,
	}, nil
}

func (r *Repository) IdentityBySubject(ctx context.Context, subject string) (UserIdentity, error) {
	var userID string
	err := r.db.QueryRowContext(ctx, "SELECT id FROM iam_user WHERE oidc_subject = $1", subject).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return UserIdentity{}, ErrUserNotFound
		}
		return UserIdentity{}, err
	}
	return r.IdentityForUser(ctx, userID)
}

func (r *Repository) WriteAuditLog(
	ctx context.Context,
	actorUserID string,
	actorSubject string,
	action string,
	resourceType string,
	resourceID string,
	result string,
	requestIP string,
	userAgent string,
	traceID string,
	details map[string]any,
) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return err
	}
	if result == "" {
		result = "success"
	}

	ip := requestIP
	if host, _, splitErr := net.SplitHostPort(requestIP); splitErr == nil {
		ip = host
	}

	_, err = r.db.ExecContext(ctx, `
INSERT INTO audit_log (
	actor_user_id, actor_subject, action, resource_type, resource_id, request_ip, user_agent, trace_id, result, details_json
) VALUES (
	NULLIF($1, '')::uuid, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10
)`,
		actorUserID,
		actorSubject,
		action,
		resourceType,
		resourceID,
		ip,
		userAgent,
		traceID,
		result,
		rawDetails,
	)
	return err
}
