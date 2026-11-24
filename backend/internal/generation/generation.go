// Package generation orchestrates the timetable solver and stores its best result.
package generation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/istu-pro-dev/timetable/backend/internal/engine"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/hard"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
	"github.com/istu-pro-dev/timetable/backend/internal/solver"
	"github.com/istu-pro-dev/timetable/backend/internal/solver/stageb"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

// ErrEmptyCurriculum is returned when the database has no schedulable lessons.
var ErrEmptyCurriculum = errors.New("no lessons are configured")

// Options configures one generation run.
type Options struct {
	Name   string
	Budget time.Duration
	Seed   uint64
}

// Progress is a point-in-time view of the anytime search.
type Progress struct {
	Stage          string   `json:"stage"`
	Percent        int      `json:"percent"`
	Lessons        int      `json:"lessons"`
	Placed         int      `json:"placed"`
	HardViolations int      `json:"hard_violations"`
	SoftPenalty    float64  `json:"soft_penalty"`
	Steps          int64    `json:"steps"`
	Elapsed        string   `json:"elapsed"`
	Preview        *Preview `json:"preview,omitempty"`
}

// Preview is the current best in-memory timetable. It is not persisted until generation ends.
type Preview struct {
	Days           int             `json:"days"`
	PeriodsPerDay  int             `json:"periods_per_day"`
	Lessons        []PreviewLesson `json:"lessons"`
	Placed         int             `json:"placed"`
	HardViolations int             `json:"hard_violations"`
	SoftPenalty    float64         `json:"soft_penalty"`
}

// PreviewLesson is one lesson and its current solver assignment.
type PreviewLesson struct {
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

// Violation is a solver constraint issue.
type Violation struct {
	Rule       string  `json:"rule"`
	Message    string  `json:"message"`
	Lessons    []int64 `json:"lesson_ids"`
	Strictness string  `json:"strictness"`
}

// Result describes the saved best schedule.
type Result struct {
	ScheduleID     int64       `json:"schedule_id"`
	Name           string      `json:"name"`
	Lessons        int         `json:"lessons"`
	Placed         int         `json:"placed"`
	HardViolations int         `json:"hard_violations"`
	SoftPenalty    float64     `json:"soft_penalty"`
	Steps          int64       `json:"steps"`
	Duration       string      `json:"duration"`
	Cancelled      bool        `json:"cancelled"`
	Violations     []Violation `json:"violations"`
}

// Solved is the in-memory output of Solve before it is saved.
type Solved struct {
	Problem  *engine.Problem
	Schedule *engine.Schedule
	Result   Result
}

// Service loads the canonical problem, runs both solver stages, and persists the result.
type Service struct {
	st *store.Store
}

// New creates a generation service backed by the canonical timetable store.
func New(st *store.Store) *Service { return &Service{st: st} }

// Generate runs a solver against the current database state and saves its best schedule.
// Cancellation stops stage B but still persists the best result found so far.
func (s *Service) Generate(
	ctx context.Context,
	actor store.Actor,
	opt Options,
	report func(Progress),
) (Result, error) {
	p, err := s.st.LoadProblem(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("load timetable data: %w", err)
	}
	solved, err := Solve(ctx, p, opt, report)
	if err != nil {
		return Result{}, err
	}
	scheduleID, err := s.save(ctx, actor, p, solved.Schedule, solved.Result)
	if err != nil {
		return Result{}, err
	}
	solved.Result.ScheduleID = scheduleID
	if report != nil {
		report(Progress{
			Stage: "completed", Percent: 100, Lessons: solved.Result.Lessons,
			Placed: solved.Result.Placed, HardViolations: solved.Result.HardViolations,
			SoftPenalty: solved.Result.SoftPenalty, Steps: solved.Result.Steps,
			Elapsed: solved.Result.Duration,
		})
	}
	return solved.Result, nil
}

// Solve runs feasibility and optimization stages in memory, reporting the best-so-far result.
func Solve(ctx context.Context, p *engine.Problem, opt Options, report func(Progress)) (*Solved, error) {
	if len(p.Lessons) == 0 {
		return nil, ErrEmptyCurriculum
	}
	if opt.Name == "" {
		opt.Name = "Рабочее расписание"
	}
	if opt.Budget <= 0 {
		opt.Budget = time.Minute
	}

	started := time.Now()
	sch := engine.NewSchedule(p)
	if report != nil {
		report(Progress{Stage: "feasibility", Percent: 5, Lessons: len(p.Lessons)})
	}
	stageA := solver.BuildFeasible(solver.NewGraph(p), sch, solver.StageAOptions{
		Seed: opt.Seed, RepairTime: min(opt.Budget/3, 10*time.Second),
	})
	if report != nil {
		initialPenalty := soft.New(p).Full(sch).Total(soft.DefaultWeights())
		report(progressFor(
			sch, stageA.Violations, p, "optimization", 25, 0, initialPenalty, time.Since(started),
		))
	}

	var steps int64
	optimizationBudget := opt.Budget - time.Since(started)
	if ctx.Err() == nil && optimizationBudget > 0 && len(p.Lessons) > 0 {
		weights := soft.DefaultWeights()
		optimizer := stageb.New(solver.NewGraph(p), sch, stageb.Options{
			Weights: &weights, Budget: optimizationBudget, Seed: opt.Seed,
			OnProgress: func(snapshot stageb.Snapshot) {
				if report != nil {
					report(progressForAssignments(
						p, snapshot.Assignments, "optimization",
						min(99, 25+int(75*snapshot.Elapsed.Seconds()/optimizationBudget.Seconds())),
						snapshot.HardViolations, snapshot.Soft.Total(weights),
						snapshot.Step, time.Since(started),
					))
				}
			},
		})
		stats := optimizer.Run(ctx)
		steps = stats.Steps
	}

	violations := hard.Check(sch, nil)
	hardViolations, _ := hard.Split(violations)
	breakdown := soft.New(p).Full(sch)
	result := Result{
		Name: opt.Name, Lessons: len(p.Lessons), Placed: placedCount(sch.Assignments()),
		HardViolations: len(hardViolations), SoftPenalty: breakdown.Total(soft.DefaultWeights()),
		Steps: steps, Duration: time.Since(started).Round(time.Millisecond).String(),
		Cancelled: ctx.Err() != nil, Violations: convertViolations(p, violations),
	}
	return &Solved{Problem: p, Schedule: sch, Result: result}, nil
}

func (s *Service) save(ctx context.Context, actor store.Actor, p *engine.Problem, sch *engine.Schedule, result Result) (int64, error) {
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	var scheduleID int64
	_, err := s.st.WithAudit(persistCtx, actor, store.Change{
		Entity: "schedule", Reason: "solver generation",
	}, func(q *db.Queries, _ pgx.Tx, change *store.Change) error {
		schedule, err := q.CreateSchedule(persistCtx, result.Name)
		if err != nil {
			return err
		}
		for i, assignment := range sch.Assignments() {
			if !assignment.Placed {
				continue
			}
			var roomID pgtype.Int8
			if assignment.Room != engine.None {
				roomID = pgtype.Int8{Int64: int64(p.Rooms[assignment.Room].ID), Valid: true}
			}
			if err := q.UpsertAssignment(persistCtx, db.UpsertAssignmentParams{
				ScheduleID: schedule.ID, LessonID: int64(p.Lessons[i].ID),
				Day: int16(assignment.Slot.Day), Period: int16(assignment.Slot.Period),
				Parity: db.Parity(assignment.Slot.Parity.String()), RoomID: roomID,
				Pinned: false,
			}); err != nil {
				return fmt.Errorf("save lesson %d: %w", p.Lessons[i].ID, err)
			}
		}
		scheduleID = schedule.ID
		result.ScheduleID = schedule.ID
		change.EntityID = fmt.Sprint(schedule.ID)
		change.After = result
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("save generated schedule: %w", err)
	}
	return scheduleID, nil
}

func progressFor(
	sch *engine.Schedule,
	violations []hard.Violation,
	p *engine.Problem,
	stage string,
	percent int,
	steps int64,
	softPenalty float64,
	elapsed time.Duration,
) Progress {
	hardOnes, _ := hard.Split(violations)
	return Progress{
		Stage: stage, Percent: percent, Lessons: len(p.Lessons), Placed: placedCount(sch.Assignments()),
		HardViolations: len(hardOnes), SoftPenalty: softPenalty, Steps: steps, Elapsed: elapsed.Round(time.Millisecond).String(),
		Preview: previewFor(p, sch.Assignments(), len(hardOnes), softPenalty),
	}
}

func progressForAssignments(
	p *engine.Problem,
	assignments []engine.Assignment,
	stage string,
	percent int,
	hardViolations int,
	softPenalty float64,
	steps int64,
	elapsed time.Duration,
) Progress {
	return Progress{
		Stage: stage, Percent: percent, Lessons: len(p.Lessons), Placed: placedCount(assignments),
		HardViolations: hardViolations, SoftPenalty: softPenalty, Steps: steps,
		Elapsed: elapsed.Round(time.Millisecond).String(),
		Preview: previewFor(p, assignments, hardViolations, softPenalty),
	}
}

func previewFor(p *engine.Problem, assignments []engine.Assignment, hardViolations int, softPenalty float64) *Preview {
	preview := &Preview{
		Days: int(p.Grid.Days), PeriodsPerDay: int(p.Grid.PeriodsPerDay),
		Lessons: make([]PreviewLesson, 0, len(p.Lessons)),
		Placed:  placedCount(assignments), HardViolations: hardViolations, SoftPenalty: softPenalty,
	}
	for i, lesson := range p.Lessons {
		assignment := assignments[i]
		item := PreviewLesson{
			ID: int64(lesson.ID), Discipline: p.Disciplines[lesson.Discipline].Name,
			Kind: lesson.Kind, Teacher: p.Teachers[lesson.Teacher].Name,
			Audience: make([]string, 0, len(lesson.Units)), Placed: assignment.Placed,
		}
		for _, unitIndex := range lesson.Units {
			unit := p.Units[unitIndex]
			label := p.Groups[unit.Group].Name
			if unit.Division != engine.None {
				label += " · п/г " + fmt.Sprint(unit.Part)
			}
			item.Audience = append(item.Audience, label)
		}
		if assignment.Placed {
			item.Day = assignment.Slot.Day.String()
			item.Period = int(assignment.Slot.Period)
			item.Parity = assignment.Slot.Parity.String()
			if assignment.Room != engine.None {
				item.Room = p.Rooms[assignment.Room].Name
			}
		}
		preview.Lessons = append(preview.Lessons, item)
	}
	return preview
}

func placedCount(assignments []engine.Assignment) int {
	n := 0
	for _, a := range assignments {
		if a.Placed {
			n++
		}
	}
	return n
}

func convertViolations(p *engine.Problem, violations []hard.Violation) []Violation {
	out := make([]Violation, 0, len(violations))
	for _, v := range violations {
		ids := make([]int64, 0, len(v.Lessons))
		for _, li := range v.Lessons {
			ids = append(ids, int64(p.Lessons[li].ID))
		}
		strictness := "hard"
		if v.Strictness == hard.HeavySoft {
			strictness = "heavy_soft"
		}
		out = append(out, Violation{Rule: v.Rule.String(), Message: v.Message, Lessons: ids, Strictness: strictness})
	}
	return out
}
