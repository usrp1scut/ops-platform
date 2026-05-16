package iam

import "strings"

// ResourceAttrs is the set of attributes of the concrete resource a request
// targets (e.g. {"env":"prod","source":"aws"}). It is resolved at the
// enforcement boundary — middleware cannot know it, only a handler that has
// loaded the resource can. A nil ResourceAttrs means "no specific resource"
// (used by the capability resolver / matrix when the question is general).
type ResourceAttrs map[string]string

// Decision is the authoritative outcome of a scoped authorization check.
// Every caller — RequireScopedPermission and the /resolve endpoint — goes
// through Authorize so the policy lives in exactly one place.
type Decision struct {
	Allowed bool
	// Partial is true when the permission is held but only within a scope.
	// For a concrete resource (attrs != nil) an allowed Partial means the
	// resource was inside scope; for a general question it means "yes, but
	// limited to Scope".
	Partial bool
	Scope   Scope
	Source  PermissionSource
	Reason  string
}

// constraintMatches reports whether one resource attribute satisfies one
// constraint. A missing attribute fails closed for in/eq (we cannot prove the
// resource is in scope) and passes for not_in (it is provably not excluded).
func constraintMatches(c ScopeConstraint, attrs ResourceAttrs) bool {
	val, ok := attrs[c.Dimension]
	switch c.Op {
	case ScopeOpIn, ScopeOpEq:
		if !ok {
			return false
		}
		for _, v := range c.Values {
			if strings.EqualFold(strings.TrimSpace(v), strings.TrimSpace(val)) {
				return true
			}
		}
		return false
	case ScopeOpNotIn:
		if !ok {
			return true
		}
		for _, v := range c.Values {
			if strings.EqualFold(strings.TrimSpace(v), strings.TrimSpace(val)) {
				return false
			}
		}
		return true
	default:
		// Unknown operator: fail closed.
		return false
	}
}

// Matches reports whether a concrete resource is inside this scope. An empty
// scope is unscoped and always matches.
func (s Scope) Matches(attrs ResourceAttrs) bool {
	if len(s) == 0 {
		return true
	}
	for _, c := range s {
		if !constraintMatches(c, attrs) {
			return false
		}
	}
	return true
}

func (id UserIdentity) scopedPermission(permission string) (ScopedPermission, bool) {
	for _, sp := range id.ScopedPermissions {
		if sp.Permission == permission {
			return sp, true
		}
	}
	return ScopedPermission{}, false
}

// Authorize is the single authoritative scope check. attrs == nil asks the
// general question ("can this user ever do X"); a non-nil attrs asks about a
// concrete resource and enforces scope against it.
func (id UserIdentity) Authorize(permission string, attrs ResourceAttrs) Decision {
	if IsAdmin(id) {
		return Decision{Allowed: true, Source: PermissionSource{Kind: "role", Ref: "admin"}, Reason: "admin bypass"}
	}

	sp, ok := id.scopedPermission(permission)
	if !ok {
		// Fall back to the coarse list so a permission that predates the
		// scoped-permission plumbing (or any non-role path) still resolves.
		for _, p := range id.Permissions {
			if p == permission {
				return Decision{Allowed: true, Source: PermissionSource{Kind: "role", Ref: "role"}, Reason: "granted"}
			}
		}
		return Decision{Allowed: false, Reason: "no grant for " + permission}
	}

	if sp.Unscoped {
		src := PermissionSource{Kind: "role", Ref: "role"}
		if len(sp.Sources) > 0 {
			src = sp.Sources[0]
		}
		return Decision{Allowed: true, Source: src, Reason: "granted (unscoped)"}
	}

	// General question: held, but only within scope.
	if attrs == nil {
		var combined Scope
		if len(sp.Scopes) > 0 {
			combined = sp.Scopes[0]
		}
		src := PermissionSource{Kind: "role", Ref: "role", Scope: combined}
		if len(sp.Sources) > 0 {
			src = sp.Sources[0]
		}
		return Decision{Allowed: true, Partial: true, Scope: combined, Source: src, Reason: "granted (scoped)"}
	}

	// Concrete resource: allowed when ANY scope (OR across roles) admits it.
	for i, sc := range sp.Scopes {
		if sc.Matches(attrs) {
			src := PermissionSource{Kind: "role", Ref: "role", Scope: sc}
			if i < len(sp.Sources) {
				src = sp.Sources[i]
			}
			return Decision{Allowed: true, Partial: true, Scope: sc, Source: src, Reason: "in scope"}
		}
	}
	return Decision{Allowed: false, Partial: true, Reason: "resource outside permitted scope for " + permission}
}
