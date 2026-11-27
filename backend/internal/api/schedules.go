package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/istu-pro-dev/timetable/backend/internal/engine"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/hard"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
	"github.com/istu-pro-dev/timetable/backend/internal/generation"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

type scheduleSummary struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type scheduledLesson struct {
	ID         int64    `json:"id"`
	Placed     bool     `json:"placed"`
	Day        string   `json:"day,omitempty"`
	Period     int      `json:"period,omitempty"`
	Parity     string   `json:"parity,omitempty"`
	Discipline string   `json:"discipline"`
	Kind       string   `json:"kind"`
	Teacher    string   `json:"teacher"`
	Audience   []string `json:"audience"`
	Room       string   `json:"room,omitempty"`
}

type scheduleDetail struct {
	ID             int64             `json:"id"`
	Name           string            `json:"name"`
	CreatedAt      time.Time         `json:"created_at"`
	Days           int               `json:"days"`
	PeriodsPerDay  int               `json:"periods_per_day"`
	Periods        []period          `json:"periods"`
	Lessons        []scheduledLesson `json:"lessons"`
	Placed         int               `json:"placed"`
	HardViolations int               `json:"hard_violations"`
	SoftPenalty    float64           `json:"soft_penalty"`
	// WeightsSnapshot is the effective soft-criterion weights used to generate this schedule.
	WeightsSnapshot map[string]float64 `json:"weights_snapshot,omitempty"`
	WeightProfileID *int64             `json:"weight_profile_id,omitempty"`
	// Soft lists every soft criterion with its value, effective weight and weighted contribution.
	Soft []generation.SoftCriterion `json:"soft,omitempty"`
}

func (s *server) listSchedules(w http.ResponseWriter, r *http.Request) {
	s.read(w, r, func(ctx context.Context, q *db.Queries) (any, error) {
		rows, err := q.ListSchedules(ctx)
		if err != nil {
			return nil, err
		}
		return mapSlice(rows, func(x db.Schedule) scheduleSummary {
			return scheduleSummary{ID: x.ID, Name: x.Name, CreatedAt: x.CreatedAt.Time}
		}), nil
	})
}

func (s *server) getSchedule(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		s.writeError(w, err, opRead)
		return
	}
	s.read(w, r, func(ctx context.Context, q *db.Queries) (any, error) {
		row, err := q.GetSchedule(ctx, id)
		if err != nil {
			return nil, orNotFound(err, "schedule")
		}
		p, err := s.store.LoadProblem(ctx)
		if err != nil {
			return nil, err
		}
		sch, err := store.LoadSchedule(ctx, q, p, id)
		if err != nil {
			return nil, err
		}
		grid, err := q.GetTimeGrid(ctx)
		if err != nil {
			return nil, err
		}
		periodRows, err := q.ListPeriods(ctx)
		if err != nil {
			return nil, err
		}
		assignments := sch.Assignments()
		lessons := make([]scheduledLesson, 0, len(p.Lessons))
		placed := 0
		for i, lesson := range p.Lessons {
			a := assignments[i]
			item := scheduledLesson{
				ID: int64(lesson.ID), Discipline: p.Disciplines[lesson.Discipline].Name,
				Kind: lesson.Kind, Teacher: p.Teachers[lesson.Teacher].Name, Audience: []string{},
				Placed: a.Placed,
			}
			for _, unitIndex := range lesson.Units {
				unit := p.Units[unitIndex]
				label := p.Groups[unit.Group].Name
				if unit.Division != engine.None {
					label += " · п/г " + strconv.Itoa(int(unit.Part))
				}
				item.Audience = append(item.Audience, label)
			}
			if a.Placed {
				placed++
				item.Day = a.Slot.Day.String()
				item.Period = int(a.Slot.Period)
				item.Parity = a.Slot.Parity.String()
				if a.Room != engine.None {
					item.Room = p.Rooms[a.Room].Name
				}
			}
			lessons = append(lessons, item)
		}
		hardViolations, _ := hard.Split(hard.Check(sch, nil))
		weights := weightsForSchedule(row)
		var weightProfileID *int64
		if row.WeightProfileID.Valid {
			id := row.WeightProfileID.Int64
			weightProfileID = &id
		}
		return scheduleDetail{
			ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt.Time,
			Days: int(grid.Days), PeriodsPerDay: int(grid.PeriodsPerDay),
			Periods: mapSlice(periodRows, toPeriod), Lessons: lessons, Placed: placed,
			HardViolations:  len(hardViolations),
			SoftPenalty:     soft.New(p).Full(sch).Total(weights),
			WeightsSnapshot: weightsSnapshot(weights),
			WeightProfileID: weightProfileID,
			Soft:            generation.SoftCriterias(p, sch, weights),
		}, nil
	})
}

func weightsForSchedule(row db.Schedule) soft.Weights {
	w := soft.DefaultWeights()
	if len(row.WeightsSnapshot) == 0 {
		return w
	}
	var m map[string]float64
	if json.Unmarshal(row.WeightsSnapshot, &m) != nil {
		return w
	}
	for k, v := range m {
		if c, ok := soft.ParseCriterion(k); ok && !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 {
			w[c] = v
		}
	}
	return w
}

func weightsSnapshot(w soft.Weights) map[string]float64 {
	out := make(map[string]float64, soft.NumCriteria)
	for c := soft.Criterion(0); c < soft.NumCriteria; c++ {
		out[c.Key()] = w[c]
	}
	return out
}
