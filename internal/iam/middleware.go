package iam

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func AuthMiddleware(tokens *TokenService, repo *Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			claims, err := tokens.Parse(token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			identity, err := repo.IdentityForUser(r.Context(), claims.UserID)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "user session not found")
				return
			}
			ctx := WithIdentity(r.Context(), identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequirePermission(resource string, action string) func(http.Handler) http.Handler {
	required := resource + ":" + action
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := IdentityFromContext(r.Context())
			if !ok {
				writeError(w, http.StatusUnauthorized, "missing identity context")
				return
			}
			for _, permission := range identity.Permissions {
				if permission == required || permission == "system:admin" {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeError(w, http.StatusForbidden, "permission denied")
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

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
