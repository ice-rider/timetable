package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/istu-pro-dev/timetable/backend/internal/engine"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/hard"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
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
		return scheduleDetail{
			ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt.Time,
			Days: int(grid.Days), PeriodsPerDay: int(grid.PeriodsPerDay),
			Periods: mapSlice(periodRows, toPeriod), Lessons: lessons, Placed: placed,
			HardViolations: len(hardViolations),
			SoftPenalty:    soft.New(p).Full(sch).Total(soft.DefaultWeights()),
		}, nil
	})
}
