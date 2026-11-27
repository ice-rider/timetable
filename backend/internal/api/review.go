package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
	"github.com/istu-pro-dev/timetable/backend/internal/httpx"
	"github.com/istu-pro-dev/timetable/backend/internal/ingest"
	"github.com/istu-pro-dev/timetable/backend/internal/review"
)

// maxReviewUpload limits the uploaded timetable file.
const maxReviewUpload = 20 << 20

// reviewSlots bounds concurrent reviews: parsing and checking a file is CPU- and memory-heavy
// and the endpoint needs no account.
var reviewSlots = make(chan struct{}, 2)

// registerReview registers the stateless review of an uploaded timetable. It needs neither a
// database nor an account: nothing is stored.
func (s *server) registerReview() {
	s.handle("POST /api/review", http.HandlerFunc(s.postReview))
}

func (s *server) postReview(w http.ResponseWriter, r *http.Request) {
	select {
	case reviewSlots <- struct{}{}:
		defer func() { <-reviewSlots }()
	default:
		w.Header().Set("Retry-After", "5")
		httpx.WriteError(w, http.StatusTooManyRequests, "busy", "another review is running, retry shortly")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxReviewUpload+1<<20)
	file, hdr, err := r.FormFile("file")
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "too_large", "the file is larger than 20 MB")
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", `expected a multipart form with a "file" field`)
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, maxReviewUpload+1))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "cannot read the uploaded file")
		return
	}
	if len(data) > maxReviewUpload {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "too_large", "the file is larger than 20 MB")
		return
	}

	var weights *soft.Weights
	if pid := r.FormValue("weight_profile_id"); pid != "" && s.store != nil {
		id, err := strconv.ParseInt(pid, 10, 64)
		if err == nil && id > 0 {
			prof, err := s.store.Queries.GetWeightProfile(r.Context(), id)
			if err != nil {
				s.logger.Warn("weight profile not found, using defaults", "id", id, "error", err)
			} else if len(prof.Weights) > 0 {
				var m map[string]float64
				if json.Unmarshal(prof.Weights, &m) == nil {
					w := toSoftWeights(m)
					weights = &w
				} else {
					s.logger.Warn("failed to unmarshal weight profile, using defaults", "id", id)
				}
			}
		}
	}

	batch, err := ingest.Load(hdr.Filename, data)
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "unsupported_file", firstLine(err))
		return
	}
	var rep *review.Report
	if weights != nil {
		rep, err = review.Analyze(batch, review.WithWeights(weights))
	} else {
		rep, err = review.Analyze(batch)
	}
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_failed", firstLine(err))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}
