package api

import (
	"net/http"

	"github.com/istu-pro-dev/timetable/backend/internal/auth"
	"github.com/istu-pro-dev/timetable/backend/internal/httpx"
	"github.com/istu-pro-dev/timetable/backend/internal/seed"
)

const maxDatasetBody = 20 << 20

type datasetImportInput struct {
	ConfirmReplace bool                 `json:"confirm_replace"`
	Dataset        seed.PortableDataset `json:"dataset"`
}

func (s *server) registerDataset() {
	s.handle("GET /api/dataset/template", auth.Require(auth.RoleAdmin)(http.HandlerFunc(s.datasetTemplate)))
	s.handle("POST /api/dataset", auth.Require(auth.RoleAdmin)(
		s.withStore(http.HandlerFunc(s.importDataset)),
	))
}

func (s *server) datasetTemplate(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Disposition", `attachment; filename="timetable-dataset.json"`)
	httpx.WriteJSON(w, http.StatusOK, seed.PortableFromDataset(seed.Build(), "Синтетический шаблон"))
}

func (s *server) importDataset(w http.ResponseWriter, r *http.Request) {
	if s.jobs.hasActive() {
		httpx.WriteError(w, http.StatusConflict, "generation_running", "stop active generation jobs before replacing timetable data")
		return
	}
	var in datasetImportInput
	if err := httpx.DecodeJSON(w, r, &in, maxDatasetBody); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if !in.ConfirmReplace {
		httpx.WriteError(w, http.StatusBadRequest, "confirmation_required",
			"confirm_replace must be true because importing a dataset replaces all reference data, curriculum and schedules")
		return
	}
	dataset, err := in.Dataset.ToDataset()
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_failed", err.Error())
		return
	}
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	counts, err := seed.LoadAs(r.Context(), s.store, dataset, principal.Actor())
	if err != nil {
		s.writeError(w, err, opWrite)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, counts)
}
