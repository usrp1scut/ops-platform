package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"sort"
	"strings"

	"github.com/google/uuid"
)

var ErrUserNotFound = errors.New("user not found")
var ErrRoleNotFound = errors.New("role not found")
var ErrUserRoleBindingNotFound = errors.New("user role binding not found")

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
	sort.Strings(roles)
	sort.Strings(perms)

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

func (r *Repository) ListUsers(ctx context.Context, query string) ([]UserWithRoles, error) {
	sqlText := `
SELECT
    u.id,
    u.oidc_subject,
    COALESCE(u.email, ''),
    COALESCE(u.name, ''),
    u.created_at,
    u.updated_at,
    COALESCE(u.last_login_at, u.updated_at),
    COALESCE(json_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '[]'::json) AS roles
FROM iam_user u
LEFT JOIN iam_user_role_binding b ON b.user_id = u.id
LEFT JOIN iam_role r ON r.id = b.role_id
WHERE ($1 = '' OR u.email ILIKE $1 OR u.name ILIKE $1 OR u.oidc_subject ILIKE $1)
GROUP BY u.id
ORDER BY COALESCE(u.last_login_at, u.updated_at) DESC
LIMIT 200`

	search := ""
	if strings.TrimSpace(query) != "" {
		search = "%" + strings.TrimSpace(query) + "%"
	}

	rows, err := r.db.QueryContext(ctx, sqlText, search)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]UserWithRoles, 0, 32)
	for rows.Next() {
		var row UserWithRoles
		var rolesRaw []byte
		if err := rows.Scan(
			&row.ID,
			&row.OIDCSubject,
			&row.Email,
			&row.Name,
			&row.CreatedAt,
			&row.UpdatedAt,
			&row.LastLoginAt,
			&rolesRaw,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(rolesRaw, &row.Roles); err != nil {
			return nil, err
		}
		users = append(users, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return users, nil
}

func (r *Repository) ListRoles(ctx context.Context) ([]Role, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, name, description, created_at
FROM iam_role
ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	roles := make([]Role, 0, 8)
	for rows.Next() {
		var role Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.CreatedAt); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return roles, nil
}

func (r *Repository) GetRoleByName(ctx context.Context, roleName string) (Role, error) {
	var role Role
	err := r.db.QueryRowContext(ctx, `
SELECT id, name, description, created_at
FROM iam_role
WHERE name = $1
`, strings.TrimSpace(roleName)).Scan(&role.ID, &role.Name, &role.Description, &role.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Role{}, ErrRoleNotFound
		}
		return Role{}, err
	}
	return role, nil
}

func (r *Repository) ListRolePermissions(ctx context.Context, roleName string) ([]RolePermission, error) {
	role, err := r.GetRoleByName(ctx, roleName)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT resource, action
FROM iam_role_permission
WHERE role_id = $1
ORDER BY resource ASC, action ASC
`, role.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	permissions := make([]RolePermission, 0, 16)
	for rows.Next() {
		var item RolePermission
		if err := rows.Scan(&item.Resource, &item.Action); err != nil {
			return nil, err
		}
		item.Permission = item.Resource + ":" + item.Action
		permissions = append(permissions, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return permissions, nil
}

func (r *Repository) ListRolesWithPermissions(ctx context.Context) ([]RoleWithPermissions, error) {
	roles, err := r.ListRoles(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]RoleWithPermissions, 0, len(roles))
	for _, role := range roles {
		permissions, err := r.ListRolePermissions(ctx, role.Name)
		if err != nil {
			return nil, err
		}
		items = append(items, RoleWithPermissions{
			Role:        role,
			Permissions: permissions,
		})
	}
	return items, nil
}

func (r *Repository) BindRoleToUser(ctx context.Context, userID, roleName string) error {
	if err := r.ensureUserExists(ctx, userID); err != nil {
		return err
	}
	roleID, err := r.roleIDByName(ctx, roleName)
	if err != nil {
		return err
	}

	_, err = r.db.ExecContext(ctx, `
INSERT INTO iam_user_role_binding (id, user_id, role_id)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, role_id) DO NOTHING
`, uuid.NewString(), userID, roleID)
	return err
}

func (r *Repository) UnbindRoleFromUser(ctx context.Context, userID, roleName string) error {
	if err := r.ensureUserExists(ctx, userID); err != nil {
		return err
	}
	roleID, err := r.roleIDByName(ctx, roleName)
	if err != nil {
		return err
	}

	result, err := r.db.ExecContext(ctx, `
DELETE FROM iam_user_role_binding
WHERE user_id = $1 AND role_id = $2
`, userID, roleID)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrUserRoleBindingNotFound
	}
	return nil
}

func (r *Repository) roleIDByName(ctx context.Context, roleName string) (string, error) {
	var roleID string
	err := r.db.QueryRowContext(ctx, `
SELECT id
FROM iam_role
WHERE name = $1
`, strings.TrimSpace(roleName)).Scan(&roleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrRoleNotFound
		}
		return "", err
	}
	return roleID, nil
}

func (r *Repository) ensureUserExists(ctx context.Context, userID string) error {
	var found bool
	err := r.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM iam_user WHERE id = $1)", userID).Scan(&found)
	if err != nil {
		return err
	}
	if !found {
		return ErrUserNotFound
	}
	return nil
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
