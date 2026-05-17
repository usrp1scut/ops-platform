package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ErrCapabilityResourceNotFound is returned by ResolveCapability when a
// resource_ref was supplied but no matching cmdb asset exists.
var ErrCapabilityResourceNotFound = errors.New("capability resource not found")

// capabilityGroup derives the matrix grouping from a resource string.
// "bastion.session" -> "bastion", "cmdb.asset" -> "cmdb", "system" -> "system".
func capabilityGroup(resource string) string {
	if i := strings.IndexByte(resource, '.'); i > 0 {
		return resource[:i]
	}
	return resource
}

// builtInCapabilityCatalog is the product's authoritative baseline: real
// capabilities the platform understands even when no role currently grants
// them. The DB query in ListCapabilities is UNIONed in at runtime so custom
// permissions added by operators still surface without a migration, but the
// matrix never loses a first-class row just because it is currently reached
// only through admin bypass or a JIT grant.
var builtInCapabilityCatalog = []Capability{
	{Resource: "aws.account", Action: "read"},
	{Resource: "aws.account", Action: "write"},
	{Resource: "bastion.grant", Action: "read"},
	{Resource: "bastion.grant", Action: "write"},
	{Resource: "bastion.request", Action: "read"},
	{Resource: "bastion.request", Action: "write"},
	{Resource: "bastion.session", Action: "connect"},
	{Resource: "bastion.session", Action: "read"},
	{Resource: "cmdb.asset", Action: "read"},
	{Resource: "cmdb.asset", Action: "write"},
	{Resource: "iam.user", Action: "read"},
	{Resource: "iam.user", Action: "write"},
	{Resource: "system", Action: "admin"},
}

// ListCapabilities returns the authoritative catalog: the built-in product
// capabilities plus any distinct (resource, action) currently referenced by a
// role permission. This is the row source for the matrix; it is broader than
// any single role and remains complete even for grant-only capabilities.
func (r *Repository) ListCapabilities(ctx context.Context) ([]Capability, error) {
	byPermission := make(map[string]Capability, len(builtInCapabilityCatalog))
	for _, c := range builtInCapabilityCatalog {
		c.Permission = c.Resource + ":" + c.Action
		c.Group = capabilityGroup(c.Resource)
		byPermission[c.Permission] = c
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT DISTINCT resource, action
FROM iam_role_permission
ORDER BY resource ASC, action ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var c Capability
		if err := rows.Scan(&c.Resource, &c.Action); err != nil {
			return nil, err
		}
		c.Permission = c.Resource + ":" + c.Action
		c.Group = capabilityGroup(c.Resource)
		byPermission[c.Permission] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]Capability, 0, len(byPermission))
	for _, c := range byPermission {
		items = append(items, c)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Resource != items[j].Resource {
			return items[i].Resource < items[j].Resource
		}
		return items[i].Action < items[j].Action
	})
	return items, nil
}

// activeGrantCount counts non-revoked, unexpired bastion grants. Ad-hoc grants
// have no scope column, so every active grant is effectively unscoped — this
// is the "N unscoped grants" warning on the matrix.
func (r *Repository) activeGrantCount(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `
SELECT count(*) FROM bastion_grant
WHERE revoked_at IS NULL AND expires_at > now()
`).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// CapabilityMatrix builds the full grid: rows = capabilities, columns = roles,
// each cell = all | partial | none with the scope and the role sources.
func (r *Repository) CapabilityMatrix(ctx context.Context) (CapabilityMatrix, error) {
	roles, err := r.ListRoles(ctx)
	if err != nil {
		return CapabilityMatrix{}, err
	}
	caps, err := r.ListCapabilities(ctx)
	if err != nil {
		return CapabilityMatrix{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT r.name, rp.resource, rp.action, rp.scope_json
FROM iam_role r
JOIN iam_role_permission rp ON rp.role_id = r.id
`)
	if err != nil {
		return CapabilityMatrix{}, err
	}
	defer rows.Close()

	// permission -> role -> cell
	cells := map[string]map[string]MatrixCell{}
	for rows.Next() {
		var roleName, resource, action string
		var scopeRaw []byte
		if err := rows.Scan(&roleName, &resource, &action, &scopeRaw); err != nil {
			return CapabilityMatrix{}, err
		}
		scope, err := parseScopeJSON(scopeRaw)
		if err != nil {
			return CapabilityMatrix{}, err
		}
		perm := resource + ":" + action
		if cells[perm] == nil {
			cells[perm] = map[string]MatrixCell{}
		}
		cell := cells[perm][roleName]
		cell.Sources = append(cell.Sources, PermissionSource{Kind: "role", Ref: roleName, Scope: scope})
		switch {
		case len(scope) == 0:
			cell.State = CellAll
			cell.Scope = nil
		case cell.State != CellAll:
			cell.State = CellPartial
			if len(cell.Scope) == 0 {
				cell.Scope = scope
			}
		}
		cells[perm][roleName] = cell
	}
	if err := rows.Err(); err != nil {
		return CapabilityMatrix{}, err
	}

	// Fill the gaps with explicit "none" so the frontend never has to guess.
	for _, c := range caps {
		if cells[c.Permission] == nil {
			cells[c.Permission] = map[string]MatrixCell{}
		}
		for _, role := range roles {
			if _, ok := cells[c.Permission][role.Name]; !ok {
				cells[c.Permission][role.Name] = MatrixCell{State: CellNone}
			}
		}
	}

	matrixRoles := make([]MatrixRole, 0, len(roles))
	for _, role := range roles {
		matrixRoles = append(matrixRoles, MatrixRole{Name: role.Name, Rank: rolePermissionRank(cells, role.Name)})
	}
	sort.SliceStable(matrixRoles, func(i, j int) bool {
		return matrixRoles[i].Rank > matrixRoles[j].Rank
	})

	unscoped, err := r.activeGrantCount(ctx)
	if err != nil {
		return CapabilityMatrix{}, err
	}

	return CapabilityMatrix{
		Roles:        matrixRoles,
		Capabilities: caps,
		Cells:        cells,
		Warnings:     MatrixWarnings{UnscopedGrants: unscoped},
	}, nil
}

// rolePermissionRank approximates breadth so wider roles sort left.
func rolePermissionRank(cells map[string]map[string]MatrixCell, roleName string) int {
	rank := 0
	for _, byRole := range cells {
		switch byRole[roleName].State {
		case CellAll:
			rank += 2
		case CellPartial:
			rank++
		}
	}
	return rank
}

// CapabilityPrincipals answers "who holds this capability today" plus the
// role sources behind it. There is no group concept in this system — roles
// are the grouping — so the summary reports users and roles honestly.
func (r *Repository) CapabilityPrincipals(ctx context.Context, permission string) (CapabilityPrincipals, error) {
	resource, action, ok := splitPermission(permission)
	if !ok {
		return CapabilityPrincipals{}, fmt.Errorf("invalid permission %q", permission)
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT DISTINCT r.name, rp.scope_json
FROM iam_role r
JOIN iam_role_permission rp ON rp.role_id = r.id
WHERE rp.resource = $1 AND rp.action = $2
ORDER BY r.name ASC
`, resource, action)
	if err != nil {
		return CapabilityPrincipals{}, err
	}
	defer rows.Close()

	sources := make([]PermissionSource, 0, 8)
	roleNames := map[string]struct{}{}
	for rows.Next() {
		var roleName string
		var scopeRaw []byte
		if err := rows.Scan(&roleName, &scopeRaw); err != nil {
			return CapabilityPrincipals{}, err
		}
		scope, err := parseScopeJSON(scopeRaw)
		if err != nil {
			return CapabilityPrincipals{}, err
		}
		sources = append(sources, PermissionSource{Kind: "role", Ref: roleName, Scope: scope})
		roleNames[roleName] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return CapabilityPrincipals{}, err
	}

	var totalUsers int
	if err := r.db.QueryRowContext(ctx, `
SELECT count(DISTINCT b.user_id)
FROM iam_role_permission rp
JOIN iam_user_role_binding b ON b.role_id = rp.role_id
WHERE rp.resource = $1 AND rp.action = $2
`, resource, action).Scan(&totalUsers); err != nil {
		return CapabilityPrincipals{}, err
	}

	roleCount := len(roleNames)
	label := fmt.Sprintf("%d user%s · %d role%s",
		totalUsers, plural(totalUsers), roleCount, plural(roleCount))

	return CapabilityPrincipals{
		Permission: permission,
		Summary:    PrincipalSummary{Users: totalUsers, Groups: roleCount, Label: label},
		Sources:    sources,
	}, nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func splitPermission(permission string) (resource, action string, ok bool) {
	i := strings.LastIndexByte(permission, ':')
	if i <= 0 || i == len(permission)-1 {
		return "", "", false
	}
	return permission[:i], permission[i+1:], true
}

type resolvedAsset struct {
	ID     string
	Name   string
	Env    string
	Source string
	Status string
}

// lookupAsset resolves a resource_ref (asset id or name) to its scope-relevant
// attributes. Raw SQL on cmdb_asset keeps iam decoupled from the cmdb package.
func (r *Repository) lookupAsset(ctx context.Context, ref string) (resolvedAsset, error) {
	var a resolvedAsset
	err := r.db.QueryRowContext(ctx, `
SELECT id::text, name, env, source, status
FROM cmdb_asset
WHERE deleted_at IS NULL AND (id::text = $1 OR name = $1)
ORDER BY (id::text = $1) DESC
LIMIT 1
`, strings.TrimSpace(ref)).Scan(&a.ID, &a.Name, &a.Env, &a.Source, &a.Status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedAsset{}, ErrCapabilityResourceNotFound
		}
		return resolvedAsset{}, err
	}
	return a, nil
}

type activeGrant struct {
	ID        string
	RequestID sql.NullString
	ExpiresAt time.Time
}

func (r *Repository) activeGrantFor(ctx context.Context, userID, assetID string) (*activeGrant, error) {
	var g activeGrant
	err := r.db.QueryRowContext(ctx, `
SELECT id::text, request_id::text, expires_at
FROM bastion_grant
WHERE user_id = $1::uuid AND asset_id = $2::uuid
  AND revoked_at IS NULL AND expires_at > now()
ORDER BY expires_at DESC
LIMIT 1
`, userID, assetID).Scan(&g.ID, &g.RequestID, &g.ExpiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &g, nil
}

func isBastionSessionCapability(permission string) bool {
	return permission == "bastion.session:connect"
}

// ResolveCapability answers "can user X do Y on Z" and returns the path that
// produces the answer. It composes role-derived scoped permissions with
// time-bounded bastion grants — the question the legacy IAM page cannot answer.
func (r *Repository) ResolveCapability(ctx context.Context, req ResolveRequest) (ResolveResult, error) {
	capability := strings.TrimSpace(req.Capability)
	if capability == "" {
		return ResolveResult{}, errors.New("capability is required")
	}

	identity, err := r.IdentityForUser(ctx, strings.TrimSpace(req.UserID))
	if err != nil {
		return ResolveResult{}, err
	}

	var asset *resolvedAsset
	var attrs ResourceAttrs
	if ref := strings.TrimSpace(req.ResourceRef); ref != "" {
		a, err := r.lookupAsset(ctx, ref)
		if err != nil {
			return ResolveResult{}, err
		}
		asset = &a
		attrs = ResourceAttrs{"env": a.Env, "source": a.Source}
	}

	decision := identity.Authorize(capability, attrs)
	if decision.Allowed {
		step := ResolveStep{
			Source:     decision.Source.Kind,
			Ref:        decision.Source.Ref,
			Capability: capability,
			Scope:      decision.Source.Scope,
			Note:       decision.Reason,
		}
		return ResolveResult{Allowed: true, Effect: "allow", Path: []ResolveStep{step}}, nil
	}

	// Role path denied — a time-bounded grant can still authorize an
	// asset-scoped bastion session.
	if asset != nil && isBastionSessionCapability(capability) {
		grant, err := r.activeGrantFor(ctx, identity.User.ID, asset.ID)
		if err != nil {
			return ResolveResult{}, err
		}
		if grant != nil {
			ref := "grant " + grant.ID
			if grant.RequestID.Valid && grant.RequestID.String != "" {
				ref = "grant " + grant.ID + " · request " + grant.RequestID.String
			}
			expires := grant.ExpiresAt
			return ResolveResult{
				Allowed:   true,
				Effect:    "allow",
				ExpiresAt: &expires,
				Path: []ResolveStep{{
					Source:     "grant",
					Ref:        ref,
					Capability: capability,
					Note:       "time-bounded grant for " + asset.Name,
				}},
			}, nil
		}
	}

	reason := decision.Reason
	if reason == "" {
		reason = "no grant for " + capability
	}
	return ResolveResult{Allowed: false, Effect: "deny", Path: []ResolveStep{}, DeniedReason: reason}, nil
}
