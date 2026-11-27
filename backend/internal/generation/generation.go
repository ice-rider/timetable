// Package generation orchestrates the timetable solver and stores its best result.
package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
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
	// Weights overrides soft-criterion weights; nil uses soft.DefaultWeights() or WeightProfileID.
	Weights *soft.Weights
	// WeightProfileID references a stored weight profile; nil uses defaults.
	WeightProfileID *int64
	// Resume continues stage B from a saved checkpoint.
	Resume *stageb.State
	// StopWhenZero stops when hard violations and weighted soft penalty are both zero.
	StopWhenZero bool
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

// SoftCriterion is one soft criterion with its effective weight and weighted contribution.
type SoftCriterion struct {
	Key       string  `json:"key"`
	Title     string  `json:"title"`
	Value     float64 `json:"value"`
	Weight    float64 `json:"weight"`
	Weighted  float64 `json:"weighted"`
	Available bool    `json:"available"`
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
	// Soft lists every soft criterion with its value, effective weight and weighted contribution.
	Soft []SoftCriterion `json:"soft,omitempty"`
	// WeightsSnapshot is the effective soft-criterion weights used for this run.
	WeightsSnapshot map[string]float64 `json:"weights_snapshot,omitempty"`
	WeightProfileID *int64             `json:"weight_profile_id,omitempty"`
	// StageBState is a checkpoint for continuing stage B.
	StageBState *stageb.State `json:"stageb_state,omitempty"`
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
	weights := soft.DefaultWeights()
	if opt.Weights != nil {
		weights = *opt.Weights
	}
	var weightProfileID *int64
	if opt.WeightProfileID != nil && *opt.WeightProfileID > 0 {
		weightProfileID = opt.WeightProfileID
		if opt.Weights == nil {
			prof, err := s.st.Queries.GetWeightProfile(ctx, *opt.WeightProfileID)
			if err != nil {
				// A missing profile falls back to defaults; the schedule stores no dangling reference.
				slog.Warn("weight profile not found for generation, using defaults", "id", *opt.WeightProfileID, "error", err)
				weightProfileID = nil
			} else {
				weights = weightsFromProfile(prof)
			}
		}
	}
	opt.Weights = &weights
	solved, err := Solve(ctx, p, opt, report)
	if err != nil {
		return Result{}, err
	}
	scheduleID, err := s.save(ctx, actor, p, solved.Schedule, solved.Result, weights, weightProfileID)
	if err != nil {
		return Result{}, err
	}
	solved.Result.ScheduleID = scheduleID
	solved.Result.WeightsSnapshot = weightsSnapshot(weights)
	solved.Result.WeightProfileID = weightProfileID
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
	weights := soft.DefaultWeights()
	if opt.Weights != nil {
		weights = *opt.Weights
	}
	if report != nil {
		report(Progress{Stage: "feasibility", Percent: 5, Lessons: len(p.Lessons)})
	}
	var stageViolations []hard.Violation
	if opt.Resume == nil {
		stageA := solver.BuildFeasible(solver.NewGraph(p), sch, solver.StageAOptions{
			Seed: opt.Seed, RepairTime: min(opt.Budget/3, 10*time.Second),
		})
		stageViolations = stageA.Violations
	}

	var steps int64
	var stageBState *stageb.State
	optimizationBudget := opt.Budget - time.Since(started)
	if ctx.Err() == nil && optimizationBudget > 0 && len(p.Lessons) > 0 {
		optimizer := stageb.New(solver.NewGraph(p), sch, stageb.Options{
			Weights: &weights, Budget: optimizationBudget, Seed: opt.Seed,
			Resume: opt.Resume, StopWhenZero: opt.StopWhenZero,
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
		stageBState = &stageb.State{}
		*stageBState = optimizer.State()
	}
	if report != nil {
		initialPenalty := soft.New(p).Full(sch).Total(weights)
		report(progressFor(
			sch, stageViolations, p, "optimization", 25, 0, initialPenalty, time.Since(started),
		))
	}
	violations := hard.Check(sch, nil)
	hardViolations, _ := hard.Split(violations)
	breakdown := soft.New(p).Full(sch)
	result := Result{
		Name: opt.Name, Lessons: len(p.Lessons), Placed: placedCount(sch.Assignments()),
		HardViolations: len(hardViolations), SoftPenalty: breakdown.Total(weights),
		Steps: steps, Duration: time.Since(started).Round(time.Millisecond).String(),
		Cancelled: ctx.Err() != nil, Violations: convertViolations(p, violations),
		Soft:            SoftCriterias(p, sch, weights),
		WeightsSnapshot: weightsSnapshot(weights),
		StageBState:     stageBState,
	}
	return &Solved{Problem: p, Schedule: sch, Result: result}, nil
}

// SoftCriterias lists every soft criterion with its raw value, the effective weight and the
// weighted contribution; available marks criteria that are enabled (weight > 0) for this run.
func SoftCriterias(p *engine.Problem, sch *engine.Schedule, w soft.Weights) []SoftCriterion {
	breakdown := soft.New(p).Full(sch)
	out := make([]SoftCriterion, 0, soft.NumCriteria)
	for c := soft.Criterion(0); c < soft.NumCriteria; c++ {
		value := float64(breakdown[c])
		weight := float64(w[c])
		out = append(out, SoftCriterion{
			Key: c.Key(), Title: criterionTitle(c), Value: value, Weight: weight,
			Weighted: value * weight, Available: weight > 0,
		})
	}
	return out
}

func criterionTitle(c soft.Criterion) string {
	switch c {
	case soft.Gaps:
		return "Окна"
	case soft.BuildingTransitions:
		return "Переходы между корпусами"
	case soft.TeacherCompactness:
		return "Учебные дни преподавателей"
	case soft.MinWorkingDays:
		return "Повторы дисциплины в один день"
	case soft.CurriculumCompactness:
		return "Одиночные пары в дне"
	case soft.RoomStability:
		return "Смена аудиторий у дисциплины"
	case soft.CapacityWaste:
		return "Пустые места (десятки)"
	case soft.EdgeSlots:
		return "Первая и последняя пара"
	case soft.RoomCount:
		return "Задействовано аудиторий"
	case soft.Preferences:
		return "Нежелательные слоты"
	}
	return c.Key()
}

func (s *Service) save(
	ctx context.Context,
	actor store.Actor,
	p *engine.Problem,
	sch *engine.Schedule,
	result Result,
	weights soft.Weights,
	weightProfileID *int64,
) (int64, error) {
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	var scheduleID int64
	snapshot := weightsSnapshot(weights)
	rawSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		return 0, fmt.Errorf("marshal weights snapshot: %w", err)
	}
	var profileID pgtype.Int8
	if weightProfileID != nil {
		profileID = pgtype.Int8{Int64: *weightProfileID, Valid: true}
	}
	_, err = s.st.WithAudit(persistCtx, actor, store.Change{
		Entity: "schedule", Reason: "solver generation",
	}, func(q *db.Queries, _ pgx.Tx, change *store.Change) error {
		schedule, err := q.CreateSchedule(persistCtx, result.Name)
		if err != nil {
			return err
		}
		if err := q.UpdateScheduleWeights(persistCtx, db.UpdateScheduleWeightsParams{
			ID: schedule.ID, WeightProfileID: profileID, WeightsSnapshot: rawSnapshot,
		}); err != nil {
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
		result.WeightsSnapshot = snapshot
		result.WeightProfileID = weightProfileID
		change.EntityID = fmt.Sprint(schedule.ID)
		change.After = result
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("save generated schedule: %w", err)
	}
	return scheduleID, nil
}

func weightsFromProfile(prof db.WeightProfile) soft.Weights {
	w := soft.DefaultWeights()
	var m map[string]float64
	if len(prof.Weights) == 0 || json.Unmarshal(prof.Weights, &m) != nil {
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
