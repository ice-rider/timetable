package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/istu-pro-dev/timetable/backend/internal/auth"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

// weightProfile is a named set of soft-criterion weights.
type weightProfile struct {
	ID        int64              `json:"id"`
	Name      string             `json:"name"`
	Weights   map[string]float64 `json:"weights"`
	CreatedAt string             `json:"created_at"`
	UpdatedAt string             `json:"updated_at"`
}

type weightProfileInput struct {
	Name    string             `json:"name"`
	Weights map[string]float64 `json:"weights"`
}

func (in *weightProfileInput) validate() error {
	var v validator
	v.text("name", &in.Name, 1, 120)
	if len(in.Weights) == 0 {
		v.addf("weights", "must not be empty")
	}
	for k, w := range in.Weights {
		if _, ok := soft.ParseCriterion(k); !ok {
			v.addf("weights", "unknown criterion %q", k)
		}
		if math.IsNaN(w) || math.IsInf(w, 0) {
			v.addf("weights", "criterion %q must be a finite number", k)
			continue
		}
		if w < 0 {
			v.addf("weights", "criterion %q must be >= 0", k)
		}
		if w != math.Trunc(w) {
			v.addf("weights", "criterion %q must be an integer", k)
		}
	}
	return v.err()
}

func toWeightProfile(r db.WeightProfile) (weightProfile, error) {
	w := map[string]float64{}
	if len(r.Weights) > 0 {
		if err := json.Unmarshal(r.Weights, &w); err != nil {
			return weightProfile{}, err
		}
	}
	return weightProfile{
		ID: r.ID, Name: r.Name, Weights: w,
		CreatedAt: formatTimestamp(r.CreatedAt), UpdatedAt: formatTimestamp(r.UpdatedAt),
	}, nil
}

func formatTimestamp(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339Nano)
}

func toSoftWeights(m map[string]float64) soft.Weights {
	w := soft.DefaultWeights()
	for k, v := range m {
		if c, ok := soft.ParseCriterion(k); ok {
			if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v != math.Trunc(v) {
				continue
			}
			w[c] = v
		}
	}
	return w
}

func weightsJSON(m map[string]float64) ([]byte, error) {
	if m == nil {
		m = map[string]float64{}
	}
	return json.Marshal(m)
}

func (s *server) registerWeightProfiles() {
	read := func(pattern string, h http.HandlerFunc) { s.handle(pattern, auth.Require()(s.withStore(h))) }
	write := func(pattern string, h http.HandlerFunc) {
		s.handle(pattern, auth.Require(auth.RoleAdmin)(s.withStore(h)))
	}

	read("GET /api/weight-profiles", s.listWeightProfiles)
	write("POST /api/weight-profiles", s.createWeightProfile)
	read("GET /api/weight-profiles/{id}", s.getWeightProfile)
	write("PUT /api/weight-profiles/{id}", s.updateWeightProfile)
	write("DELETE /api/weight-profiles/{id}", s.deleteWeightProfile)
}

func (s *server) listWeightProfiles(w http.ResponseWriter, r *http.Request) {
	s.read(w, r, func(ctx context.Context, q *db.Queries) (any, error) {
		rows, err := q.ListWeightProfiles(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]weightProfile, 0, len(rows))
		for _, row := range rows {
			p, err := toWeightProfile(row)
			if err != nil {
				return nil, err
			}
			out = append(out, p)
		}
		return out, nil
	})
}

func (s *server) getWeightProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.writeError(w, err, opRead)
		return
	}
	s.read(w, r, func(ctx context.Context, q *db.Queries) (any, error) {
		row, err := q.GetWeightProfile(ctx, id)
		if err != nil {
			return nil, orNotFound(err, "weight profile")
		}
		return toWeightProfile(row)
	})
}

func (s *server) createWeightProfile(w http.ResponseWriter, r *http.Request) {
	var in weightProfileInput
	if !s.decode(w, r, &in) {
		return
	}
	s.mutate(w, r, mutation{entity: "weight_profile", op: opWrite, status: http.StatusCreated,
		run: func(ctx context.Context, q *db.Queries, c *store.Change) (any, error) {
			raw, err := weightsJSON(in.Weights)
			if err != nil {
				return nil, err
			}
			row, err := q.CreateWeightProfile(ctx, db.CreateWeightProfileParams{Name: in.Name, Weights: raw})
			if err != nil {
				return nil, err
			}
			out, err := toWeightProfile(row)
			if err != nil {
				return nil, err
			}
			c.EntityID, c.After = idString(row.ID), out
			return out, nil
		}})
}

func (s *server) updateWeightProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.writeError(w, err, opWrite)
		return
	}
	var in weightProfileInput
	if !s.decode(w, r, &in) {
		return
	}
	s.mutate(w, r, mutation{entity: "weight_profile", entityID: idString(id), op: opWrite, status: http.StatusOK,
		run: func(ctx context.Context, q *db.Queries, c *store.Change) (any, error) {
			before, err := q.GetWeightProfile(ctx, id)
			if err != nil {
				return nil, orNotFound(err, "weight profile")
			}
			raw, err := weightsJSON(in.Weights)
			if err != nil {
				return nil, err
			}
			row, err := q.UpdateWeightProfile(ctx, db.UpdateWeightProfileParams{ID: id, Name: in.Name, Weights: raw})
			if err != nil {
				return nil, err
			}
			out, err := toWeightProfile(row)
			if err != nil {
				return nil, err
			}
			bef, _ := toWeightProfile(before)
			c.Before, c.After = bef, out
			return out, nil
		}})
}

func (s *server) deleteWeightProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.writeError(w, err, opDelete)
		return
	}
	s.mutate(w, r, mutation{entity: "weight_profile", entityID: idString(id), op: opDelete, status: http.StatusNoContent,
		run: func(ctx context.Context, q *db.Queries, c *store.Change) (any, error) {
			before, err := q.GetWeightProfile(ctx, id)
			if err != nil {
				return nil, orNotFound(err, "weight profile")
			}
			inUse, err := q.WeightProfileInUse(ctx, pgtype.Int8{Int64: id, Valid: true})
			if err != nil {
				return nil, err
			}
			if inUse.Bool || s.jobs != nil && s.jobs.hasWeightProfileInUse(id) {
				return nil, inUseError("weight profile is referenced by other records")
			}
			bef, _ := toWeightProfile(before)
			c.Before = bef
			_, err = q.DeleteWeightProfile(ctx, id)
			return nil, err
		}})
}
