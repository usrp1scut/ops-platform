package bastion

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
)

// RequireActiveGrant gates a route on the caller having an active bastion
// grant for the asset named by paramName in the route pattern. Holders of
// system:admin bypass the check (admins are allowed to connect anywhere; the
// audit trail still records who connected).
//
// On failure, the response body includes needs_grant=true so the portal can
// open a Request-access modal pre-filled for the right asset, instead of
// surfacing a generic "permission denied".
func RequireActiveGrant(repo *Repository, paramName string) func(http.Handler) http.Handler {
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
