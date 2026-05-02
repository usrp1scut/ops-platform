package bastion

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"ops-platform/internal/iam"
	"ops-platform/internal/platform/httpx"
)

type Handler struct {
	repo            *Repository
	requireGrantRW  func(http.Handler) http.Handler
	requireGrantRO  func(http.Handler) http.Handler
	requireReqRW    func(http.Handler) http.Handler
	requireReqRO    func(http.Handler) http.Handler
	maxDurationSecs int
}

const (
	defaultMaxDurationSecs = 12 * 3600 // 12h cap on requested grants
)

func NewHandler(
	repo *Repository,
	grantRead func(http.Handler) http.Handler,
	grantWrite func(http.Handler) http.Handler,
	requestRead func(http.Handler) http.Handler,
	requestWrite func(http.Handler) http.Handler,
) *Handler {
	return &Handler{
		repo:            repo,
		requireGrantRO:  grantRead,
		requireGrantRW:  grantWrite,
		requireReqRO:    requestRead,
		requireReqRW:    requestWrite,
		maxDurationSecs: defaultMaxDurationSecs,
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Route("/grants", func(r chi.Router) {
		r.With(h.requireGrantRO).Get("/", h.listGrants)
		r.With(h.requireGrantRW).Post("/", h.createGrant)
		r.With(h.requireGrantRW).Delete("/{grantID}", h.revokeGrant)
	})

	r.Route("/requests", func(r chi.Router) {
		r.With(h.requireReqRO).Get("/", h.listRequests)
		r.With(h.requireReqRW).Post("/", h.createRequest)
		r.With(h.requireReqRW).Post("/{requestID}/cancel", h.cancelRequest)
		r.With(h.requireGrantRW).Post("/{requestID}/approve", h.approveRequest)
		r.With(h.requireGrantRW).Post("/{requestID}/reject", h.rejectRequest)
	})
	return r
}

// canSeeAllBastionRecords returns true when the caller is permitted to view
// other users' grants and requests. Approvers (bastion.grant:write) and
// admins qualify; everyone else is restricted to their own rows. The list
// endpoints accept user_id as a hint, but unprivileged callers cannot
// override their own scope no matter what they pass.
func canSeeAllBastionRecords(identity iam.UserIdentity) bool {
	if iam.IsAdmin(identity) {
		return true
	}
	for _, p := range identity.Permissions {
		if p == "bastion.grant:write" {
			return true
		}
	}
	return false
}

// --- Grants ---

func (h *Handler) listGrants(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	q := ListGrantsQuery{
		UserID:  r.URL.Query().Get("user_id"),
		AssetID: r.URL.Query().Get("asset_id"),
	}
	if !canSeeAllBastionRecords(identity) {
		// Force self-scope. Anything else would let viewer/requester roles
		// enumerate who got which asset and the reason.
		q.UserID = identity.User.ID
	}
	if v := r.URL.Query().Get("active"); v == "true" || v == "1" {
		q.ActiveOnly = true
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		q.Offset = v
	}
	items, err := h.repo.ListGrants(r.Context(), q)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createGrantRequest struct {
	UserID           string `json:"user_id"`
	AssetID          string `json:"asset_id"`
	Reason           string `json:"reason"`
	DurationSeconds  int    `json:"duration_seconds"`
	ExpiresAtRFC3339 string `json:"expires_at"` // optional explicit override
}

func (h *Handler) createGrant(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	var req createGrantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.UserID == "" || req.AssetID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "user_id and asset_id are required")
		return
	}
	if req.UserID == identity.User.ID {
		// Two-person rule: an approver must not be able to bypass approval
		// by directly granting themselves. Mirrors ErrSelfApprovalDenied.
		httpx.WriteError(w, http.StatusForbidden, ErrSelfGrantDenied.Error())
		return
	}
	if req.DurationSeconds <= 0 {
		req.DurationSeconds = 3600
	}
	if req.DurationSeconds > h.maxDurationSecs {
		httpx.WriteError(w, http.StatusBadRequest, "duration exceeds maximum")
		return
	}
	expiresAt := nowPlusSeconds(req.DurationSeconds)
	in := CreateGrantInput{
		UserID:    req.UserID,
		AssetID:   req.AssetID,
		Reason:    req.Reason,
		ExpiresAt: expiresAt,
	}
	g, err := h.repo.CreateGrant(r.Context(), in, identity.User.ID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, g)
}

type revokeGrantRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) revokeGrant(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	var req revokeGrantRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // body optional
	in := RevokeGrantInput{
		GrantID:      chi.URLParam(r, "grantID"),
		RevokedByID:  identity.User.ID,
		RevokeReason: req.Reason,
	}
	if err := h.repo.RevokeGrant(r.Context(), in, identity.User.Name); err != nil {
		if errors.Is(err, ErrGrantNotFound) {
			httpx.WriteError(w, http.StatusNotFound, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// --- Requests ---

func (h *Handler) listRequests(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	q := ListRequestsQuery{
		UserID: r.URL.Query().Get("user_id"),
		Status: RequestStatus(r.URL.Query().Get("status")),
	}
	// Non-approvers can only see their own requests, regardless of any
	// user_id query parameter or the mine= flag. mine=true is a no-op for
	// scoped callers and an opt-in narrowing for approvers.
	if !canSeeAllBastionRecords(identity) {
		q.UserID = identity.User.ID
	} else if r.URL.Query().Get("mine") == "true" {
		q.UserID = identity.User.ID
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		q.Limit = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil {
		q.Offset = v
	}
	items, err := h.repo.ListRequests(r.Context(), q)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createRequestPayload struct {
	AssetID         string `json:"asset_id"`
	Reason          string `json:"reason"`
	DurationSeconds int    `json:"duration_seconds"`
}

func (h *Handler) createRequest(w http.ResponseWriter, r *http.Request) {
	identity, ok := iam.IdentityFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity")
		return
	}
	var req createRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.AssetID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "asset_id is required")
		return
	}
	if req.DurationSeconds <= 0 {
		req.DurationSeconds = 3600
	}
	if req.DurationSeconds > h.maxDurationSecs {
		httpx.WriteError(w, http.StatusBadRequest, "duration exceeds maximum")
		return
	}
	in := CreateRequestInput{
		UserID:                   identity.User.ID,
		AssetID:                  req.AssetID,
		Reason:                   req.Reason,
		RequestedDurationSeconds: req.DurationSeconds,
	}
	out, err := h.repo.CreateRequest(r.Context(), in)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, out)
}

type decideRequestPayload struct {
	Reason string `json:"reason"`
}

func (h *Handler) approveRequest(w http.ResponseWriter, r *http.Request) {
	identity, _ := iam.IdentityFromContext(r.Context())
	var p decideRequestPayload
	_ = json.NewDecoder(r.Body).Decode(&p)
	in := DecideRequestInput{
		RequestID:      chi.URLParam(r, "requestID"),
		DecidedByID:    identity.User.ID,
		DecisionReason: p.Reason,
	}
	req, grant, err := h.repo.ApproveRequest(r.Context(), in, identity.User.Name)
	if err != nil {
		switch {
		case errors.Is(err, ErrRequestNotFound):
			httpx.WriteError(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrRequestNotPending):
			httpx.WriteError(w, http.StatusConflict, err.Error())
		case errors.Is(err, ErrSelfApprovalDenied):
			httpx.WriteError(w, http.StatusForbidden, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"request": req, "grant": grant})
}

func (h *Handler) rejectRequest(w http.ResponseWriter, r *http.Request) {
	identity, _ := iam.IdentityFromContext(r.Context())
	var p decideRequestPayload
	_ = json.NewDecoder(r.Body).Decode(&p)
	in := DecideRequestInput{
		RequestID:      chi.URLParam(r, "requestID"),
		DecidedByID:    identity.User.ID,
		DecisionReason: p.Reason,
	}
	req, err := h.repo.RejectRequest(r.Context(), in, identity.User.Name)
	if err != nil {
		switch {
		case errors.Is(err, ErrRequestNotPending):
			httpx.WriteError(w, http.StatusConflict, err.Error())
		default:
			httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, req)
}

func (h *Handler) cancelRequest(w http.ResponseWriter, r *http.Request) {
	identity, _ := iam.IdentityFromContext(r.Context())
	req, err := h.repo.CancelRequest(r.Context(), chi.URLParam(r, "requestID"), identity.User.ID)
	if err != nil {
		if errors.Is(err, ErrRequestNotPending) {
			httpx.WriteError(w, http.StatusConflict, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, req)
}
