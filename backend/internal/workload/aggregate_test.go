package workload

import (
	"testing"

	"github.com/istu-pro-dev/timetable/backend/internal/ingest/ttx"
	"github.com/istu-pro-dev/timetable/backend/internal/seed"
)

func TestFromBatchConvertsWeeklyRhythmToSemesterHours(t *testing.T) {
	batch := &ttx.Batch{
		Source: ttx.Source{File: "sample.xls"},
		Periods: []ttx.Period{
			{N: 1, Start: "08:30", End: "10:00"},
			{N: 2, Start: "10:10", End: "11:40"},
		},
		Groups:   []ttx.Group{{Key: "Б26-071-1"}, {Key: "Б26-071-2"}},
		Teachers: []ttx.Teacher{{Key: "Иванов И.И."}},
		Rooms:    []ttx.Room{{Key: "1-101", Building: "1", Type: "lecture"}},
		Lessons: []ttx.Lesson{
			{
				ID: 1, Day: "mon", Period: 1, Parity: "every", LessonType: "lecture",
				Discipline: "Математика", Teachers: []string{"Иванов И.И."}, Room: "1-101",
				Audience: []ttx.Member{{Group: "Б26-071-1"}, {Group: "Б26-071-2"}},
			},
			{
				ID: 2, Day: "tue", Period: 1, Parity: "odd", LessonType: "practice",
				Discipline: "Физика", Teachers: []string{"Иванов И.И."}, Room: "1-101",
				Audience: []ttx.Member{{Group: "Б26-071-1"}},
			},
			{
				ID: 3, Day: "tue", Period: 2, Parity: "even", LessonType: "practice",
				Discipline: "Физика", Teachers: []string{"Иванов И.И."}, Room: "1-101",
				Audience: []ttx.Member{{Group: "Б26-071-1"}},
			},
			{
				ID: 4, Day: "wed", Period: 2, Parity: "odd", LessonType: "lab",
				Discipline: "Химия", Teachers: []string{"Иванов И.И."}, Room: "1-101",
				Audience: []ttx.Member{{Group: "Б26-071-2"}},
			},
		},
	}

	got, err := FromBatch(batch, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.TimeGrid.Days != 6 || got.TimeGrid.PeriodsPerDay != 2 {
		t.Fatalf("time grid = %+v", got.TimeGrid)
	}
	if len(got.CurriculumItems) != 3 {
		t.Fatalf("curriculum items = %d, want 3", len(got.CurriculumItems))
	}
	if got.SemesterWeeks != 18 {
		t.Fatalf("semester weeks = %d, want 18", got.SemesterWeeks)
	}
	math := findLoad(t, got, "Математика")
	if math.SemesterHours != 36 || len(math.Audience) != 2 {
		t.Errorf("weekly stream load = %+v", math)
	}
	physics := findLoad(t, got, "Физика")
	if physics.SemesterHours != 36 {
		t.Errorf("alternating load = %+v", physics)
	}
	chemistry := findLoad(t, got, "Химия")
	if chemistry.SemesterHours != 18 {
		t.Errorf("odd-week-only load = %+v", chemistry)
	}
	if got.Groups[0].Course != 1 || got.Groups[0].Size != defaultGroupSize {
		t.Errorf("synthetic group defaults = %+v", got.Groups[0])
	}
	if len(got.Rooms) != 1 || got.Rooms[0].Capacity != 60 {
		t.Errorf("synthetic rooms = %+v", got.Rooms)
	}
}

func findLoad(t *testing.T, dataset seed.PortableDataset, discipline string) seed.PortableCurriculumItem {
	t.Helper()
	for _, item := range dataset.CurriculumItems {
		for _, d := range dataset.Disciplines {
			if item.Discipline == d.Key && d.Name == discipline {
				return item
			}
		}
	}
	t.Fatalf("cannot find load %q", discipline)
	return seed.PortableCurriculumItem{}
}
