package httpserver

import (
	"net/http"
	"strconv"

	awsrepo "ops-platform/internal/aws"
	"ops-platform/internal/awssync"
	"ops-platform/internal/platform/httpx"
)

type awsSyncHandler struct {
	repo   *awsrepo.Repository
	runner *awssync.Runner
}

func newAWSSyncHandler(repo *awsrepo.Repository, runner *awssync.Runner) *awsSyncHandler {
	return &awsSyncHandler{
		repo:   repo,
		runner: runner,
	}
}

func (h *awsSyncHandler) Trigger(w http.ResponseWriter, _ *http.Request) {
	started := h.runner.Trigger()
	status := h.runner.Status()
	if !started {
		httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
			"triggered": false,
			"message":   "sync is already running",
			"status":    status,
		})
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{
		"triggered": true,
		"message":   "sync triggered",
		"status":    status,
	})
}

func (h *awsSyncHandler) Status(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, h.runner.Status())
}

func (h *awsSyncHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}

	runs, err := h.repo.ListSyncRuns(r.Context(), limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": runs,
		"limit": limit,
	})
}
