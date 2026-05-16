package iam

import "time"

type User struct {
	ID          string    `json:"id"`
	OIDCSubject string    `json:"oidc_subject"`
	Email       string    `json:"email,omitempty"`
	Name        string    `json:"name,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	LastLoginAt time.Time `json:"last_login_at"`
}

type UserWithRoles struct {
	User
	Roles []string `json:"roles"`
}

type UserProfile struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
}

type UserIdentity struct {
	User        User     `json:"user"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	// ScopedPermissions carries the same permissions as Permissions plus the
	// effective scope per permission. Permissions stays the coarse
	// has-it-at-all list for backward compatibility; scope narrows it at the
	// resource boundary via Authorize.
	ScopedPermissions []ScopedPermission `json:"scoped_permissions,omitempty"`
}

type Role struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type RolePermission struct {
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	Permission string `json:"permission"`
	// Scope nil/empty == unscoped (the holder may act on every resource
	// instance). Non-empty == AND-combined constraints; see migration 0022.
	Scope Scope `json:"scope,omitempty"`
}

type RoleWithPermissions struct {
	Role
	Permissions []RolePermission `json:"permissions"`
}

// ScopeOp is the comparison applied to a resource attribute.
type ScopeOp string

const (
	ScopeOpIn    ScopeOp = "in"
	ScopeOpNotIn ScopeOp = "not_in"
	ScopeOpEq    ScopeOp = "eq"
)

// ScopeConstraint narrows one resource attribute (e.g. env, source).
type ScopeConstraint struct {
	Dimension string   `json:"dimension"`
	Op        ScopeOp  `json:"op"`
	Values    []string `json:"values"`
}

// Scope is an AND-combined set of constraints. A nil or empty Scope means
// "unscoped" — the permission applies to every resource instance.
type Scope []ScopeConstraint

// PermissionSource records where a (scoped) permission came from so the
// matrix cell inspector and the resolver can show the path.
type PermissionSource struct {
	Kind  string `json:"kind"` // "role" | "grant"
	Ref   string `json:"ref"`  // role name, or grant/request reference
	Scope Scope  `json:"scope,omitempty"`
}

// ScopedPermission is the effective grant of one permission to a user across
// all their roles. If any role grants it unscoped, Unscoped is true and Scopes
// is ignored. Otherwise the user is allowed when ANY entry in Scopes is
// satisfied (OR across roles), each entry being AND-combined internally.
type ScopedPermission struct {
	Permission string             `json:"permission"`
	Resource   string             `json:"resource"`
	Action     string             `json:"action"`
	Unscoped   bool               `json:"unscoped"`
	Scopes     []Scope            `json:"scopes,omitempty"`
	Sources    []PermissionSource `json:"sources,omitempty"`
}

// Capability is one row of the matrix: a verb on a resource class.
type Capability struct {
	Permission  string `json:"permission"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
	Group       string `json:"group"`
	Description string `json:"description,omitempty"`
}

type MatrixCellState string

const (
	CellAll     MatrixCellState = "all"
	CellPartial MatrixCellState = "partial"
	CellNone    MatrixCellState = "none"
)

type MatrixCell struct {
	State   MatrixCellState    `json:"state"`
	Scope   Scope              `json:"scope,omitempty"`
	Sources []PermissionSource `json:"sources,omitempty"`
}

type MatrixRole struct {
	Name string `json:"name"`
	Rank int    `json:"rank"`
}

type MatrixWarnings struct {
	UnscopedGrants int `json:"unscoped_grants"`
}

type CapabilityMatrix struct {
	Roles        []MatrixRole                      `json:"roles"`
	Capabilities []Capability                      `json:"capabilities"`
	Cells        map[string]map[string]MatrixCell  `json:"cells"`
	Warnings     MatrixWarnings                    `json:"warnings"`
}

type PrincipalSummary struct {
	Users  int    `json:"users"`
	Groups int    `json:"groups"`
	Label  string `json:"label"`
}

type CapabilityPrincipals struct {
	Permission string             `json:"permission"`
	Summary    PrincipalSummary   `json:"summary"`
	Sources    []PermissionSource `json:"sources"`
}

type ResolveRequest struct {
	UserID      string `json:"user_id"`
	Capability  string `json:"capability"`
	ResourceRef string `json:"resource_ref"`
}

type ResolveStep struct {
	Source     string `json:"source"` // "role" | "grant" | "profile"
	Ref        string `json:"ref"`
	Capability string `json:"capability"`
	Scope      Scope  `json:"scope,omitempty"`
	Note       string `json:"note,omitempty"`
}

type ResolveResult struct {
	Allowed      bool          `json:"allowed"`
	Effect       string        `json:"effect"` // "allow" | "deny"
	ExpiresAt    *time.Time    `json:"expires_at,omitempty"`
	Path         []ResolveStep `json:"path"`
	DeniedReason string        `json:"denied_reason,omitempty"`
}

type BindRoleRequest struct {
	RoleName string `json:"role_name"`
}

type LocalLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type OIDCSettings struct {
	Exists          bool      `json:"-"`
	Enabled         bool      `json:"enabled"`
	IssuerURL       string    `json:"issuer_url"`
	ClientID        string    `json:"client_id"`
	ClientSecret    string    `json:"-"`
	HasClientSecret bool      `json:"has_client_secret"`
	RedirectURL     string    `json:"redirect_url"`
	AuthorizeURL    string    `json:"authorize_url"`
	TokenURL        string    `json:"token_url"`
	UserInfoURL     string    `json:"userinfo_url"`
	Scopes          []string  `json:"scopes"`
	UpdatedAt       time.Time `json:"updated_at,omitempty"`
}

type UpdateOIDCSettingsRequest struct {
	Enabled      bool     `json:"enabled"`
	IssuerURL    string   `json:"issuer_url"`
	ClientID     string   `json:"client_id"`
	ClientSecret *string  `json:"client_secret"`
	RedirectURL  string   `json:"redirect_url"`
	AuthorizeURL string   `json:"authorize_url"`
	TokenURL     string   `json:"token_url"`
	UserInfoURL  string   `json:"userinfo_url"`
	Scopes       []string `json:"scopes"`
}

type TokenClaims struct {
	UserID      string   `json:"uid"`
	Subject     string   `json:"sub"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"perms"`
	ExpiresAt   int64    `json:"exp"`
	IssuedAt    int64    `json:"iat"`
}
