package generation

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/istu-pro-dev/timetable/backend/internal/domain"
	"github.com/istu-pro-dev/timetable/backend/internal/engine"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/hard"
	"github.com/istu-pro-dev/timetable/backend/internal/seed"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
	"github.com/istu-pro-dev/timetable/backend/internal/store/storetest"
)

func testProblem(t *testing.T) *engine.Problem {
	t.Helper()
	p, err := engine.NewProblem(engine.Input{
		Grid:      domain.Grid{Days: 2, PeriodsPerDay: 2},
		Buildings: []engine.Building{{ID: 1, Name: "Campus"}},
		Rooms:     []engine.RoomInput{{ID: 1, Name: "R-101", Building: 1, Type: "seminar", Capacity: 30}},
		Teachers:  []engine.TeacherInput{{ID: 1, Name: "Учитель 1"}},
		Groups:    []engine.Group{{ID: 1, Name: "ГР-1", Size: 20}},
		Disciplines: []engine.Discipline{
			{ID: 1, Name: "Математика"},
		},
		Lessons: []engine.LessonInput{
			{ID: 1, Item: 1, Discipline: 1, Kind: "seminar", Teacher: 1, RoomType: "seminar", Audience: domain.Audience{domain.WholeGroup(1)}},
			{ID: 2, Item: 2, Discipline: 1, Kind: "seminar", Teacher: 1, RoomType: "seminar", Audience: domain.Audience{domain.WholeGroup(1)}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSolvePlacesLessonsAndReportsProgress(t *testing.T) {
	var progress []Progress
	result, err := Solve(context.Background(), testProblem(t), Options{
		Name: "Тестовое расписание", Budget: time.Second, Seed: 1,
	}, func(p Progress) {
		progress = append(progress, p)
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Result.Lessons != 2 || result.Result.Placed != 2 || result.Result.HardViolations != 0 {
		t.Fatalf("solver result = %+v", result.Result)
	}
	if violations := hard.Check(result.Schedule, nil); len(violations) != 0 {
		t.Fatalf("hard violations: %+v", violations)
	}
	if len(progress) < 2 || progress[0].Stage != "feasibility" {
		t.Fatalf("progress updates = %+v", progress)
	}
	var preview *Preview
	for _, update := range progress {
		if update.Preview != nil {
			preview = update.Preview
		}
	}
	if preview == nil || preview.Placed != 2 || preview.HardViolations != 0 || len(preview.Lessons) != 2 {
		t.Fatalf("best-so-far preview = %+v, want 2 conflict-free lessons", preview)
	}
	if preview.Lessons[0].Discipline != "Математика" || preview.Lessons[0].Audience[0] != "ГР-1" {
		t.Fatalf("preview lesson details = %+v", preview.Lessons[0])
	}
}

func TestSolveCancelledStillReturnsBestSoFar(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := Solve(ctx, testProblem(t), Options{Budget: time.Second, Seed: 2}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Result.Cancelled || result.Result.Placed != 2 {
		t.Fatalf("cancelled result = %+v", result.Result)
	}
}

func TestSolveRequiresLessons(t *testing.T) {
	p, err := engine.NewProblem(engine.Input{
		Grid:      domain.Grid{Days: 1, PeriodsPerDay: 1},
		Buildings: []engine.Building{{ID: 1, Name: "Campus"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = Solve(context.Background(), p, Options{}, nil)
	if !errors.Is(err, ErrEmptyCurriculum) {
		t.Fatalf("Solve error = %v, want %v", err, ErrEmptyCurriculum)
	}
}

func TestGeneratePersistsSyntheticSchedule(t *testing.T) {
	st := storetest.New(t)
	ctx := t.Context()
	if _, err := seed.Load(ctx, st, seed.Build()); err != nil {
		t.Fatal(err)
	}
	result, err := New(st).Generate(ctx, store.Actor{
		Type: db.ActorTypeHuman, ID: "test-admin",
	}, Options{Name: "Demo run", Budget: time.Second, Seed: 1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.ScheduleID <= 0 || result.Lessons != 411 || result.Placed != result.Lessons {
		t.Fatalf("generated result = %+v", result)
	}
	row, err := st.GetSchedule(ctx, result.ScheduleID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Name != "Demo run" {
		t.Fatalf("stored schedule name = %q", row.Name)
	}
	assignments, err := st.ListAssignments(ctx, result.ScheduleID)
	if err != nil {
		t.Fatal(err)
	}
	if len(assignments) != result.Placed {
		t.Fatalf("stored assignments = %d, want %d", len(assignments), result.Placed)
	}
}
