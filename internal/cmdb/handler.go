package cmdb

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// BastionRunner is the subset of bastionprobe.Service the handler needs.
// It's an interface to keep the cmdb package free of a bastionprobe dep.
type BastionRunner interface {
	ProbeAsset(ctx context.Context, assetID string) (AssetProbeSnapshot, error)
	TestConnection(ctx context.Context, assetID string) error
}

type Handler struct {
	masterKey string
	repo      *Repository
	bastion   BastionRunner
	readMW    func(http.Handler) http.Handler
	writeMW   func(http.Handler) http.Handler
}

func NewHandler(
	masterKey string,
	repo *Repository,
	bastion BastionRunner,
	readMW func(http.Handler) http.Handler,
	writeMW func(http.Handler) http.Handler,
) *Handler {
	return &Handler{
		masterKey: masterKey,
		repo:      repo,
		bastion:   bastion,
		readMW:    readMW,
		writeMW:   writeMW,
	}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.With(h.withReadAuth).Get("/", h.ListAssets)
	r.With(h.withReadAuth).Get("/facets", h.ListAssetFacets)
	r.With(h.withWriteAuth).Post("/", h.CreateAsset)
	r.With(h.withReadAuth).Get("/{assetID}", h.GetAsset)
	r.With(h.withWriteAuth).Patch("/{assetID}", h.UpdateAsset)
	r.With(h.withWriteAuth).Delete("/{assetID}", h.DeleteAsset)
	r.With(h.withReadAuth).Get("/{assetID}/connection", h.GetAssetConnection)
	r.With(h.withWriteAuth).Get("/{assetID}/connection/resolve", h.ResolveAssetConnection)
	r.With(h.withWriteAuth).Put("/{assetID}/connection", h.UpsertAssetConnection)
	r.With(h.withReadAuth).Get("/{assetID}/probe/latest", h.GetLatestAssetProbe)
	r.With(h.withWriteAuth).Post("/{assetID}/probe", h.UpsertAssetProbe)
	r.With(h.withWriteAuth).Post("/{assetID}/probe/run", h.RunAssetProbe)
	r.With(h.withWriteAuth).Post("/{assetID}/connection/test", h.TestAssetConnection)
	r.With(h.withReadAuth).Get("/{assetID}/relations", h.ListAssetRelations)
	r.With(h.withWriteAuth).Post("/{assetID}/relations", h.CreateRelation)
	r.With(h.withWriteAuth).Delete("/{assetID}/relations/{relationID}", h.DeleteRelation)

	return r
}

func (h *Handler) withReadAuth(next http.Handler) http.Handler {
	if h.readMW == nil {
		return next
	}
	return h.readMW(next)
}

func (h *Handler) withWriteAuth(next http.Handler) http.Handler {
	if h.writeMW == nil {
		return next
	}
	return h.writeMW(next)
}

func (h *Handler) ListAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	result, err := h.repo.ListAssets(r.Context(), ListAssetsQuery{
		Type:        q.Get("type"),
		Env:         q.Get("env"),
		Status:      q.Get("status"),
		Source:      q.Get("source"),
		Region:      q.Get("region"),
		AccountID:   q.Get("account_id"),
		Owner:       q.Get("owner"),
		Criticality: q.Get("criticality"),
		Query:       q.Get("q"),
		Limit:       limit,
		Offset:      offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CreateAsset(w http.ResponseWriter, r *http.Request) {
	var req CreateAssetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.Type == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "type and name are required")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if req.Env == "" {
		req.Env = "default"
	}
	if req.Source == "" {
		req.Source = "manual"
	}

	asset, err := h.repo.CreateAsset(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (h *Handler) GetAsset(w http.ResponseWriter, r *http.Request) {
	asset, err := h.repo.GetAsset(r.Context(), chi.URLParam(r, "assetID"))
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (h *Handler) UpdateAsset(w http.ResponseWriter, r *http.Request) {
	var req UpdateAssetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	asset, err := h.repo.UpdateAsset(r.Context(), chi.URLParam(r, "assetID"), req)
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (h *Handler) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	err := h.repo.DeleteAsset(r.Context(), chi.URLParam(r, "assetID"))
	if err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) GetAssetConnection(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	profile, err := h.repo.GetAssetConnectionProfile(r.Context(), assetID, false, h.masterKey)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound), errors.Is(err, ErrConnectionProfileNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *Handler) ResolveAssetConnection(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	profile, err := h.repo.ResolveAssetConnectionProfile(r.Context(), assetID, h.masterKey)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound), errors.Is(err, ErrConnectionProfileNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *Handler) UpsertAssetConnection(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")

	var req UpsertAssetConnectionProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	profile, err := h.repo.UpsertAssetConnectionProfile(r.Context(), assetID, req, h.masterKey)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *Handler) GetLatestAssetProbe(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	snapshot, err := h.repo.GetLatestAssetProbeSnapshot(r.Context(), assetID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound), errors.Is(err, ErrProbeSnapshotNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (h *Handler) UpsertAssetProbe(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	var req UpsertAssetProbeSnapshotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	snapshot, err := h.repo.UpsertAssetProbeSnapshot(r.Context(), assetID, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (h *Handler) RunAssetProbe(w http.ResponseWriter, r *http.Request) {
	if h.bastion == nil {
		writeError(w, http.StatusServiceUnavailable, "bastion probe service not configured")
		return
	}
	assetID := chi.URLParam(r, "assetID")
	snapshot, err := h.bastion.ProbeAsset(r.Context(), assetID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound), errors.Is(err, ErrConnectionProfileNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (h *Handler) TestAssetConnection(w http.ResponseWriter, r *http.Request) {
	if h.bastion == nil {
		writeError(w, http.StatusServiceUnavailable, "bastion probe service not configured")
		return
	}
	assetID := chi.URLParam(r, "assetID")
	if err := h.bastion.TestConnection(r.Context(), assetID); err != nil {
		switch {
		case errors.Is(err, ErrAssetNotFound), errors.Is(err, ErrConnectionProfileNotFound):
			writeError(w, http.StatusNotFound, err.Error())
		default:
			writeError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) ListAssetFacets(w http.ResponseWriter, r *http.Request) {
	facets, err := h.repo.ListAssetFacets(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if facets.Envs == nil {
		facets.Envs = []string{}
	}
	if facets.Types == nil {
		facets.Types = []string{}
	}
	if facets.Statuses == nil {
		facets.Statuses = []string{}
	}
	if facets.Sources == nil {
		facets.Sources = []string{}
	}
	if facets.Regions == nil {
		facets.Regions = []string{}
	}
	writeJSON(w, http.StatusOK, facets)
}

func (h *Handler) ListAssetRelations(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	rels, err := h.repo.ListRelationsByAsset(r.Context(), assetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rels == nil {
		rels = []AssetRelation{}
	}
	writeJSON(w, http.StatusOK, rels)
}

func (h *Handler) CreateRelation(w http.ResponseWriter, r *http.Request) {
	assetID := chi.URLParam(r, "assetID")
	var req CreateRelationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.RelationType == "" {
		writeError(w, http.StatusBadRequest, "relation_type is required")
		return
	}
	if req.FromAssetID == "" {
		req.FromAssetID = assetID
	}
	if req.ToAssetID == "" {
		req.ToAssetID = assetID
	}
	rel, err := h.repo.UpsertRelation(r.Context(), req.FromAssetID, req.ToAssetID, req.RelationType, "manual")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

func (h *Handler) DeleteRelation(w http.ResponseWriter, r *http.Request) {
	relID := chi.URLParam(r, "relationID")
	if err := h.repo.DeleteRelation(r.Context(), relID); err != nil {
		if errors.Is(err, ErrAssetNotFound) {
			writeError(w, http.StatusNotFound, "relation not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("writeJSON: encode failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody{Error: message})
}
