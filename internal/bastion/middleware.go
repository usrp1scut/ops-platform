package bastion

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
)

// RequireSessionAuthorization gates the terminal/RDP ticket path. It is the
// most security-critical chokepoint in the product, so authorization is the
// composition of three OR branches, evaluated in order:
//
//  1. system:admin            -> allow (audit still records the connect).
//  2. scoped role capability  -> allow if the caller holds
//     bastion.session:<action> and the target asset's scope attributes
//     (env, source) satisfy that capability's scope. This is routed through
//     the SAME iam.UserIdentity.Authorize evaluator that backs the /resolve
//     endpoint and RequireScopedPermission, so the connect path and the
//     resolver can never disagree.
//  3. active JIT grant        -> the existing per-asset escalation path.
//
// This is purely additive: with every scope_json NULL and no role holding
// bastion.session:<action> (today's seed data) branch 2 is never true for a
// non-admin, so behaviour is identical to the previous admin-or-grant gate.
// It is an OR, not an AND, because a pure grant holder may have no role
// capability at all — gating that user on a role permission would break the
// JIT flow.
func RequireSessionAuthorization(repo *Repository, action, paramName string) func(http.Handler) http.Handler {
	capability := "bastion.session:" + action
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := iam.IdentityFromContext(r.Context())
			if !ok {
				httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
				return
			}
			if iam.IsAdmin(identity) {
				next.ServeHTTP(w, r)
				return
			}
			assetID := chi.URLParam(r, paramName)
			if assetID == "" {
				httpx.WriteError(w, http.StatusBadRequest, "asset id required")
				return
			}

			// Branch 2: scoped role capability admits this specific asset.
			env, source, found, err := repo.AssetScopeAttrs(r.Context(), assetID)
			if err != nil {
				httpx.WriteError(w, http.StatusInternalServerError, err.Error())
				return
			}
			var attrs iam.ResourceAttrs
			if found {
				attrs = iam.ResourceAttrs{"env": env, "source": source}
			}
			if identity.Authorize(capability, attrs).Allowed {
				next.ServeHTTP(w, r)
				return
			}

			// Branch 3: existing active JIT grant.
			if _, err := repo.FindActiveGrant(r.Context(), identity.User.ID, assetID); err != nil {
				if errors.Is(err, ErrGrantNotFound) {
					httpx.WriteJSON(w, http.StatusForbidden, map[string]any{
						"error":       "no active grant for this asset",
						"needs_grant": true,
						"asset_id":    assetID,
					})
					return
				}
				httpx.WriteError(w, http.StatusInternalServerError, err.Error())
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
