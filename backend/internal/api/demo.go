package api

import (
	"net/http"

	"github.com/istu-pro-dev/timetable/backend/internal/auth"
	"github.com/istu-pro-dev/timetable/backend/internal/httpx"
	"github.com/istu-pro-dev/timetable/backend/internal/seed"
)

type demoSeedInput struct {
	ConfirmReplace bool `json:"confirm_replace"`
}

func (s *server) registerDemoData() {
	s.handle("GET /api/demo/dataset", auth.Require(auth.RoleAdmin)(http.HandlerFunc(s.demoDatasetStatus)))
	s.handle("POST /api/demo/dataset", auth.Require(auth.RoleAdmin)(
		s.withStore(http.HandlerFunc(s.loadDemoDataset)),
	))
}

func (s *server) demoDatasetStatus(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"enabled": s.allowDemoSeed})
}

func (s *server) loadDemoDataset(w http.ResponseWriter, r *http.Request) {
	if !s.allowDemoSeed {
		httpx.WriteError(w, http.StatusForbidden, "demo_disabled", "synthetic dataset loading is enabled only in development")
		return
	}
	if s.jobs.hasActive() {
		httpx.WriteError(w, http.StatusConflict, "generation_running", "stop active generation jobs before replacing timetable data")
		return
	}
	var in demoSeedInput
	if err := httpx.DecodeJSON(w, r, &in, maxBody); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if !in.ConfirmReplace {
		httpx.WriteError(w, http.StatusBadRequest, "confirmation_required",
			"confirm_replace must be true because loading the demo replaces all reference data, curriculum and schedules")
		return
	}
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	counts, err := seed.LoadAs(r.Context(), s.store, seed.Build(), principal.Actor())
	if err != nil {
		s.writeError(w, err, opWrite)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, counts)
}
