package iam

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"ops-platform/internal/platform/httpx"
)

func AuthMiddleware(tokens *TokenService, repo *Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				httpx.WriteError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			claims, err := tokens.Parse(token)
			if err != nil {
				httpx.WriteError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			identity, err := repo.IdentityForUser(r.Context(), claims.UserID)
			if err != nil {
				httpx.WriteError(w, http.StatusUnauthorized, "user session not found")
				return
			}
			ctx := WithIdentity(r.Context(), identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminPermission is the permission string that bypasses every other
// authorization check. Defined here so callers (notably bastion grant gate)
// agree on what "admin" means without re-hardcoding the literal.
const AdminPermission = "system:admin"

// IsAdmin reports whether the identity carries the admin bypass permission.
// Centralized so changing the bypass policy (e.g. adding "AND not_terminated")
// is a one-line change across all auth gates.
func IsAdmin(identity UserIdentity) bool {
	for _, p := range identity.Permissions {
		if p == AdminPermission {
			return true
		}
	}
	return false
}

func RequirePermission(resource string, action string) func(http.Handler) http.Handler {
	required := resource + ":" + action
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := IdentityFromContext(r.Context())
			if !ok {
				httpx.WriteError(w, http.StatusUnauthorized, "missing identity context")
				return
			}
			if IsAdmin(identity) {
				next.ServeHTTP(w, r)
				return
			}
			for _, permission := range identity.Permissions {
				if permission == required {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.WriteError(w, http.StatusForbidden, "permission denied")
		})
	}
}

// RequireScopedPermission gates a route on a permission AND the scope of the
// concrete resource the request targets. attrsFrom resolves the resource's
// scope attributes (e.g. env, source) from the request — typically after the
// handler's resource id is known, so it is applied per-route by callers that
// can identify the resource, not as a blanket middleware (a static middleware
// cannot know which asset a request touches). It delegates to the same
// Authorize evaluator as the /resolve endpoint, so enforcement and the
// resolver can never disagree. attrsFrom returning (nil, nil) means "resource
// not identifiable here" and falls back to the coarse unscoped check.
func RequireScopedPermission(
	resource string,
	action string,
	attrsFrom func(*http.Request) (ResourceAttrs, error),
) func(http.Handler) http.Handler {
	permission := resource + ":" + action
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := IdentityFromContext(r.Context())
			if !ok {
				httpx.WriteError(w, http.StatusUnauthorized, "missing identity context")
				return
			}
			var attrs ResourceAttrs
			if attrsFrom != nil {
				resolved, err := attrsFrom(r)
				if err != nil {
					httpx.WriteError(w, http.StatusBadRequest, err.Error())
					return
				}
				attrs = resolved
			}
			if identity.Authorize(permission, attrs).Allowed {
				next.ServeHTTP(w, r)
				return
			}
			httpx.WriteError(w, http.StatusForbidden, "permission denied")
		})
	}
}

func AuditMiddleware(repo *Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)

			method := r.Method
			if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
				return
			}

			identity, _ := IdentityFromContext(r.Context())
			routePattern := r.URL.Path
			if routeCtx := chi.RouteContext(r.Context()); routeCtx != nil {
				if pattern := routeCtx.RoutePattern(); pattern != "" {
					routePattern = pattern
				}
			}

			resourceType := "api"
			resourceID := routePattern
			_ = repo.WriteAuditLog(
				r.Context(),
				identity.User.ID,
				identity.User.OIDCSubject,
				method,
				resourceType,
				resourceID,
				"success",
				r.RemoteAddr,
				r.UserAgent(),
				requestID(r),
				map[string]any{
					"path": routePattern,
				},
			)
		})
	}
}

func requestID(r *http.Request) string {
	return strings.TrimSpace(middleware.GetReqID(r.Context()))
}

