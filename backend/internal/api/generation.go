package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/istu-pro-dev/timetable/backend/internal/auth"
	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
	"github.com/istu-pro-dev/timetable/backend/internal/generation"
	"github.com/istu-pro-dev/timetable/backend/internal/httpx"
	"github.com/istu-pro-dev/timetable/backend/internal/solver/stageb"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

const (
	maxGenerationJobs = 8
	maxGenerationTime = 5 * time.Minute
)

var errJobsBusy = errors.New("generation queue is full")

type generateInput struct {
	Name            string `json:"name"`
	BudgetSeconds   int    `json:"budget_seconds"`
	Seed            uint64 `json:"seed"`
	WeightProfileID *int64 `json:"weight_profile_id"`
	// Weights are raw per-run effective weights when no saved profile is referenced.
	Weights            map[string]float64 `json:"weights"`
	StopWhenZero       bool               `json:"stop_when_zero"`
	TotalBudgetSeconds int                `json:"total_budget_seconds"`
	// continuation fields are set internally or by /continue.
	ContinuationOf         string        `json:"continuation_of,omitempty"`
	ContinueFromScheduleID *int64        `json:"continue_from_schedule_id,omitempty"`
	Attempt                int           `json:"attempt,omitempty"`
	Resume                 *stageb.State `json:"-"`
}

func (in *generateInput) validate() error {
	var v validator
	v.text("name", &in.Name, 0, 120)
	if in.BudgetSeconds == 0 {
		in.BudgetSeconds = 30
	}
	v.between("budget_seconds", int64(in.BudgetSeconds), 1, int64(maxGenerationTime/time.Second))
	if in.WeightProfileID != nil && *in.WeightProfileID <= 0 {
		v.addf("weight_profile_id", "must be a positive id")
	}
	if err := validateWeights(in.Weights); err != nil {
		return err
	}
	if in.TotalBudgetSeconds < 0 {
		v.addf("total_budget_seconds", "must be >= 0")
	}
	return v.err()
}

func (in *continueInput) validate() error {
	var v validator
	if in.BudgetSeconds == 0 {
		in.BudgetSeconds = 30
	}
	v.between("budget_seconds", int64(in.BudgetSeconds), 1, int64(maxGenerationTime/time.Second))
	if err := validateWeights(in.Weights); err != nil {
		return err
	}
	if in.TotalBudgetSeconds < 0 {
		v.addf("total_budget_seconds", "must be >= 0")
	}
	return v.err()
}

// continueInput configures a continuation of one generation job; it reuses the soft-weight rules
// of generateInput without a persisted weight profile.
type continueInput struct {
	Name               string             `json:"name"`
	BudgetSeconds      int                `json:"budget_seconds"`
	Seed               uint64             `json:"seed"`
	Weights            map[string]float64 `json:"weights"`
	StopWhenZero       bool               `json:"stop_when_zero"`
	TotalBudgetSeconds int                `json:"total_budget_seconds"`
	Attempt            int                `json:"attempt"`
}

// validateWeights checks the raw soft-criterion weights of a run.
func validateWeights(weights map[string]float64) error {
	var v validator
	for k, w := range weights {
		if _, ok := soft.ParseCriterion(k); !ok {
			v.addf("weights", "unknown criterion %q", k)
		}
		if math.IsNaN(w) || math.IsInf(w, 0) || w < 0 {
			v.addf("weights", "criterion %q must be >= 0", k)
			continue
		}
		if w != math.Trunc(w) {
			v.addf("weights", "criterion %q must be an integer", k)
		}
	}
	return v.err()
}

type generationJob struct {
	mu            sync.RWMutex
	id            string
	name          string
	status        string
	budgetSeconds int
	seed          uint64
	progress      generation.Progress
	result        *generation.Result
	err           string
	cancel        context.CancelFunc
	scheduleID    int64
	// WeightProfileID and WeightsSnapshot describe the effective weights for this job.
	weightProfileID        *int64
	weightsSnapshot        map[string]float64
	stageBState            *stageb.State
	continuationOf         string
	continueFromScheduleID *int64
	attempt                int
	totalBudgetSeconds     int
	stopWhenZero           bool
	createdAt              time.Time
	startedAt              *time.Time
	finishedAt             *time.Time
}

type jobView struct {
	ID                     string                     `json:"id"`
	Status                 string                     `json:"status"`
	Stage                  string                     `json:"stage"`
	Progress               int                        `json:"progress"`
	Lessons                int                        `json:"lessons"`
	Placed                 int                        `json:"placed"`
	HardViolations         int                        `json:"hard_violations"`
	SoftPenalty            float64                    `json:"soft_penalty"`
	Steps                  int64                      `json:"steps"`
	Elapsed                string                     `json:"elapsed"`
	BudgetSeconds          int                        `json:"budget_seconds"`
	Preview                *generation.Preview        `json:"preview,omitempty"`
	ScheduleID             int64                      `json:"schedule_id,omitempty"`
	Result                 *generation.Result         `json:"result,omitempty"`
	Error                  string                     `json:"error,omitempty"`
	WeightProfileID        *int64                     `json:"weight_profile_id,omitempty"`
	WeightsSnapshot        map[string]float64         `json:"weights_snapshot,omitempty"`
	Soft                   []generation.SoftCriterion `json:"soft,omitempty"`
	ContinuationOf         string                     `json:"continuation_of,omitempty"`
	ContinueFromScheduleID *int64                     `json:"continue_from_schedule_id,omitempty"`
	Attempt                int                        `json:"attempt,omitempty"`
	TotalBudgetSeconds     int                        `json:"total_budget_seconds,omitempty"`
	StopWhenZero           bool                       `json:"stop_when_zero,omitempty"`
}

type jobManager struct {
	mu      sync.RWMutex
	jobs    map[string]*generationJob
	workers chan struct{}
	service *generation.Service
	st      *store.Store
}

func newJobManager(st *store.Store) *jobManager {
	return &jobManager{
		jobs: make(map[string]*generationJob), workers: make(chan struct{}, 1),
		service: generation.New(st), st: st,
	}
}

func (m *jobManager) start(actor store.Actor, in generateInput) (jobView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.jobs) >= maxGenerationJobs {
		for id, existing := range m.jobs {
			existing.mu.RLock()
			terminal := existing.status == "completed" || existing.status == "failed" || existing.status == "cancelled"
			existing.mu.RUnlock()
			if terminal {
				delete(m.jobs, id)
				if len(m.jobs) < maxGenerationJobs {
					break
				}
			}
		}
		if len(m.jobs) >= maxGenerationJobs {
			return jobView{}, errJobsBusy
		}
	}
	var rawID [16]byte
	if _, err := rand.Read(rawID[:]); err != nil {
		return jobView{}, fmt.Errorf("create generation job id: %w", err)
	}
	id := hex.EncodeToString(rawID[:])
	ctx, cancel := context.WithCancel(context.Background())
	job := &generationJob{
		id: id, name: in.Name, status: "queued", budgetSeconds: in.BudgetSeconds, cancel: cancel,
		weightProfileID: in.WeightProfileID, seed: in.Seed, continuationOf: in.ContinuationOf,
		attempt: in.Attempt, totalBudgetSeconds: in.TotalBudgetSeconds, stopWhenZero: in.StopWhenZero,
		continueFromScheduleID: in.ContinueFromScheduleID, createdAt: time.Now(), stageBState: in.Resume,
	}
	attempt := in.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	job.attempt = attempt
	if in.Weights != nil {
		job.weightsSnapshot = normalizeWeightSnapshot(in.Weights)
	}
	m.jobs[id] = job
	m.persistJob(ctx, job)
	go m.run(ctx, actor, in, job)
	return viewJob(job), nil
}

func (m *jobManager) run(ctx context.Context, actor store.Actor, in generateInput, job *generationJob) {
	defer job.cancel()
	select {
	case m.workers <- struct{}{}:
		defer func() { <-m.workers }()
	case <-ctx.Done():
		job.mu.Lock()
		job.status = "cancelled"
		now := time.Now()
		job.finishedAt = &now
		m.persistJob(context.WithoutCancel(ctx), job)
		job.mu.Unlock()
		return
	}

	if ctx.Err() != nil {
		job.mu.Lock()
		job.status = "cancelled"
		now := time.Now()
		job.finishedAt = &now
		m.persistJob(context.WithoutCancel(ctx), job)
		job.mu.Unlock()
		return
	}

	job.mu.Lock()
	job.status = "running"
	now := time.Now()
	job.startedAt = &now
	m.persistJob(context.WithoutCancel(ctx), job)
	job.mu.Unlock()
	result, err := m.service.Generate(ctx, actor, generation.Options{
		Name: in.Name, Budget: time.Duration(in.BudgetSeconds) * time.Second, Seed: in.Seed,
		WeightProfileID: in.WeightProfileID,
		Weights:         weightsFromSnapshot(job.weightsSnapshot),
		Resume:          in.Resume, StopWhenZero: in.StopWhenZero,
	}, func(p generation.Progress) {
		job.mu.Lock()
		job.progress = p
		m.persistJob(context.WithoutCancel(ctx), job)
		job.mu.Unlock()
	})
	job.mu.Lock()
	defer func() {
		now := time.Now()
		job.finishedAt = &now
		m.persistJob(context.WithoutCancel(ctx), job)
		job.mu.Unlock()
	}()
	switch {
	case err != nil:
		job.status = "failed"
		job.err = err.Error()
	case result.Cancelled || ctx.Err() != nil:
		result.Cancelled = true
		job.status = "cancelled"
		job.result = &result
		job.weightsSnapshot = result.WeightsSnapshot
		job.weightProfileID = result.WeightProfileID
		job.stageBState = result.StageBState
	case result.ScheduleID > 0:
		job.status = "completed"
		job.result = &result
		job.weightsSnapshot = result.WeightsSnapshot
		job.weightProfileID = result.WeightProfileID
		job.stageBState = result.StageBState
		job.scheduleID = result.ScheduleID
	default:
		job.status = "failed"
		job.err = "generation finished without a saved schedule"
	}
}

func (m *jobManager) persistJob(ctx context.Context, job *generationJob) {
	if m == nil || m.st == nil || m.st.Queries == nil || job == nil {
		return
	}
	status := job.status
	if status == "" {
		status = "queued"
	}
	var scheduleID pgtype.Int8
	if job.scheduleID > 0 {
		scheduleID = pgtype.Int8{Int64: job.scheduleID, Valid: true}
	}
	var profileID pgtype.Int8
	if job.weightProfileID != nil && *job.weightProfileID > 0 {
		profileID = pgtype.Int8{Int64: *job.weightProfileID, Valid: true}
	}
	var continueFromSchedule pgtype.Int8
	if job.continueFromScheduleID != nil {
		continueFromSchedule = pgtype.Int8{Int64: *job.continueFromScheduleID, Valid: true}
	}
	var continuationOf pgtype.Text
	if job.continuationOf != "" {
		continuationOf = pgtype.Text{String: job.continuationOf, Valid: true}
	}
	var errText pgtype.Text
	if job.err != "" {
		errText = pgtype.Text{String: job.err, Valid: true}
	}
	weights, _ := json.Marshal(job.weightsSnapshot)
	var preview []byte
	if job.progress.Preview != nil {
		preview, _ = json.Marshal(job.progress.Preview)
	}
	var result []byte
	if job.result != nil {
		result, _ = json.Marshal(job.result)
	}
	var stageBState []byte
	if job.stageBState != nil {
		stageBState, _ = json.Marshal(job.stageBState)
	}
	createdAt := job.createdAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	attempt := job.attempt
	if attempt <= 0 {
		attempt = 1
	}
	var startedAt, finishedAt pgtype.Timestamptz
	if job.startedAt != nil {
		startedAt = pgtype.Timestamptz{Time: *job.startedAt, Valid: true}
	}
	if job.finishedAt != nil {
		finishedAt = pgtype.Timestamptz{Time: *job.finishedAt, Valid: true}
	}
	var totalBudget pgtype.Int4
	if job.totalBudgetSeconds > 0 {
		totalBudget = pgtype.Int4{Int32: int32(job.totalBudgetSeconds), Valid: true}
	}
	_, _ = m.st.Queries.UpsertScheduleJob(ctx, db.UpsertScheduleJobParams{
		ID: job.id, Name: job.name, Status: status, Stage: job.progress.Stage,
		Progress: int32(job.progress.Percent), Lessons: int32(job.progress.Lessons), Placed: int32(job.progress.Placed),
		HardViolations: int32(job.progress.HardViolations), SoftPenalty: job.progress.SoftPenalty,
		Steps: job.progress.Steps, Elapsed: job.progress.Elapsed, BudgetSeconds: int32(job.budgetSeconds),
		Seed: int64(job.seed), Error: errText, ScheduleID: scheduleID, WeightProfileID: profileID,
		WeightsSnapshot: weights, Preview: preview, Result: result, ContinuationOf: continuationOf,
		ContinueFromScheduleID: continueFromSchedule, Attempt: int32(attempt), TotalBudgetSeconds: totalBudget,
		StopWhenZero: job.stopWhenZero, StagebState: stageBState, CheckpointAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Column27: createdAt, StartedAt: startedAt, FinishedAt: finishedAt,
	})
}

func weightsFromSnapshot(m map[string]float64) *soft.Weights {
	if m == nil {
		return nil
	}
	w := soft.DefaultWeights()
	for k, v := range m {
		if c, ok := soft.ParseCriterion(k); ok {
			w[c] = v
		}
	}
	return &w
}

func normalizeWeightSnapshot(m map[string]float64) map[string]float64 {
	w := soft.DefaultWeights()
	for k, v := range m {
		if c, ok := soft.ParseCriterion(k); ok && !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v == math.Trunc(v) {
			w[c] = v
		}
	}
	out := make(map[string]float64, soft.NumCriteria)
	for c := soft.Criterion(0); c < soft.NumCriteria; c++ {
		out[c.Key()] = w[c]
	}
	return out
}

func jobFromDBRow(row db.ScheduleJob) *generationJob {
	j := &generationJob{
		id: row.ID, name: row.Name, status: row.Status, budgetSeconds: int(row.BudgetSeconds), seed: uint64(row.Seed),
		progress: generation.Progress{Stage: row.Stage, Percent: int(row.Progress), Lessons: int(row.Lessons),
			Placed: int(row.Placed), HardViolations: int(row.HardViolations), SoftPenalty: row.SoftPenalty,
			Steps: row.Steps, Elapsed: row.Elapsed},
		err:             textFromPgtype(row.Error),
		scheduleID:      int64(pInt8(row.ScheduleID)),
		weightProfileID: int64Ptr(row.WeightProfileID),
		weightsSnapshot: mapFromJSON(row.WeightsSnapshot),
		attempt:         int(row.Attempt), totalBudgetSeconds: pInt4ToInt(row.TotalBudgetSeconds),
		stopWhenZero: row.StopWhenZero,
		createdAt:    timestamptzToTime(row.CreatedAt), startedAt: timestamptzToTimePtr(row.StartedAt),
		finishedAt: timestamptzToTimePtr(row.FinishedAt),
	}
	if len(row.StagebState) > 0 {
		var st stageb.State
		if err := json.Unmarshal(row.StagebState, &st); err == nil {
			j.stageBState = &st
		}
	}
	if len(row.Preview) > 0 {
		var pv *generation.Preview
		if err := json.Unmarshal(row.Preview, &pv); err == nil {
			j.progress.Preview = pv
		}
	}
	if len(row.Result) > 0 {
		var res *generation.Result
		if err := json.Unmarshal(row.Result, &res); err == nil {
			j.result = res
		}
	}
	return j
}

func textFromPgtype(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func pInt8(v pgtype.Int8) int64 {
	if !v.Valid {
		return 0
	}
	return v.Int64
}

func pInt4ToInt(v pgtype.Int4) int {
	if !v.Valid {
		return 0
	}
	return int(v.Int32)
}

func timestamptzToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

func timestamptzToTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	tt := t.Time
	return &tt
}

func mapFromJSON(b []byte) map[string]float64 {
	out := map[string]float64{}
	if len(b) == 0 {
		return out
	}
	_ = json.Unmarshal(b, &out)
	return out
}

func scheduleJobFromDB(row db.ScheduleJob) jobView {
	var weights map[string]float64
	if len(row.WeightsSnapshot) > 0 {
		_ = json.Unmarshal(row.WeightsSnapshot, &weights)
	}
	var preview *generation.Preview
	if len(row.Preview) > 0 {
		_ = json.Unmarshal(row.Preview, &preview)
	}
	var result *generation.Result
	if len(row.Result) > 0 {
		_ = json.Unmarshal(row.Result, &result)
	}
	v := jobView{
		ID: row.ID, Status: row.Status, Stage: row.Stage, Progress: int(row.Progress),
		Lessons: int(row.Lessons), Placed: int(row.Placed), HardViolations: int(row.HardViolations),
		SoftPenalty: row.SoftPenalty, Steps: row.Steps, Elapsed: row.Elapsed, BudgetSeconds: int(row.BudgetSeconds),
		Preview: preview, Result: result, WeightProfileID: int64Ptr(row.WeightProfileID),
		WeightsSnapshot: weights,
	}
	if row.ScheduleID.Valid {
		v.ScheduleID = row.ScheduleID.Int64
	}
	if result != nil {
		v.Soft = result.Soft
	}
	if row.ContinuationOf.Valid {
		v.ContinuationOf = row.ContinuationOf.String
	}
	if row.ContinueFromScheduleID.Valid {
		v.ContinueFromScheduleID = int64Ptr(row.ContinueFromScheduleID)
	}
	v.Attempt = int(row.Attempt)
	if row.TotalBudgetSeconds.Valid {
		v.TotalBudgetSeconds = int(row.TotalBudgetSeconds.Int32)
	}
	v.StopWhenZero = row.StopWhenZero
	if row.Error.Valid {
		v.Error = row.Error.String
	}
	return v
}

func int64Ptr(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	x := v.Int64
	return &x
}

func (m *jobManager) get(id string) (jobView, bool) {
	m.mu.RLock()
	job, ok := m.jobs[id]
	m.mu.RUnlock()
	if !ok {
		return jobView{}, false
	}
	return viewJob(job), true
}

func (m *jobManager) stop(id string) bool {
	m.mu.RLock()
	job, ok := m.jobs[id]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	job.mu.RLock()
	cancel := job.cancel
	job.mu.RUnlock()
	cancel()
	return true
}

func (m *jobManager) getJob(id string) (*generationJob, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	return job, ok
}

// sourceJob resolves a job from the in-memory queue or from the persisted schedule_jobs history.
func (m *jobManager) sourceJob(ctx context.Context, id string) (*generationJob, error) {
	if job, ok := m.getJob(id); ok {
		return job, nil
	}
	row, err := m.st.Queries.GetScheduleJob(ctx, id)
	if err != nil {
		return nil, orNotFound(err, "schedule job")
	}
	return jobFromDBRow(row), nil
}

// listJobs returns the persisted schedule_jobs history, newest first.
func (m *jobManager) listJobs(ctx context.Context) ([]jobView, error) {
	rows, err := m.st.Queries.ListScheduleJobs(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]jobView, 0, len(rows))
	for i := range rows {
		out = append(out, scheduleJobFromDB(rows[i]))
	}
	return out, nil
}

// continueJob starts a new generation job that resumes the stage B checkpoint of the source job.
func (m *jobManager) continueJob(ctx context.Context, actor store.Actor, id string, in continueInput) (jobView, error) {
	src, err := m.sourceJob(ctx, id)
	if err != nil {
		return jobView{}, err
	}
	if src == nil {
		return jobView{}, notFound("schedule job")
	}
	weights := weightsFromSnapshot(src.weightsSnapshot)
	if in.Weights != nil {
		weights = weightsFromSnapshot(in.Weights)
	}
	var weightsMap map[string]float64
	if weights != nil {
		weightsMap = weightsSnapshot(*weights)
	}
	next := generateInput{
		Name:                   src.name,
		BudgetSeconds:          in.BudgetSeconds,
		Seed:                   src.seed,
		Weights:                weightsMap,
		WeightProfileID:        src.weightProfileID,
		StopWhenZero:           in.StopWhenZero,
		TotalBudgetSeconds:     in.TotalBudgetSeconds,
		Resume:                 src.stageBState,
		ContinuationOf:         src.id,
		ContinueFromScheduleID: src.continueFromScheduleID,
		Attempt:                src.attempt + 1,
	}
	job, err := m.start(actor, next)
	if err != nil {
		return jobView{}, err
	}
	return job, nil
}

func (m *jobManager) hasWeightProfileInUse(id int64) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, job := range m.jobs {
		job.mu.RLock()
		inUse := job.weightProfileID != nil && *job.weightProfileID == id
		job.mu.RUnlock()
		if inUse {
			return true
		}
	}
	return false
}

func (m *jobManager) hasActive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, job := range m.jobs {
		job.mu.RLock()
		active := job.status == "queued" || job.status == "running"
		job.mu.RUnlock()
		if active {
			return true
		}
	}
	return false
}

// jobResultSoft lists the soft criteria of the best result, if there is one.
func (j *generationJob) jobResultSoft() []generation.SoftCriterion {
	if j.result == nil {
		return nil
	}
	return j.result.Soft
}

func viewJob(job *generationJob) jobView {
	job.mu.RLock()
	defer job.mu.RUnlock()
	v := jobView{
		ID: job.id, Status: job.status, Stage: job.progress.Stage, Progress: job.progress.Percent,
		Lessons: job.progress.Lessons, Placed: job.progress.Placed,
		HardViolations: job.progress.HardViolations, SoftPenalty: job.progress.SoftPenalty,
		Steps: job.progress.Steps, Elapsed: job.progress.Elapsed, BudgetSeconds: job.budgetSeconds,
		Preview: job.progress.Preview, Error: job.err,
		WeightProfileID: job.weightProfileID, WeightsSnapshot: job.weightsSnapshot,
		Soft:                   job.jobResultSoft(),
		ContinuationOf:         job.continuationOf,
		ContinueFromScheduleID: job.continueFromScheduleID,
		Attempt:                job.attempt,
		TotalBudgetSeconds:     job.totalBudgetSeconds,
		StopWhenZero:           job.stopWhenZero,
	}
	if job.result != nil {
		result := *job.result
		result.Violations = slices.Clone(job.result.Violations)
		v.Result = &result
		v.ScheduleID = result.ScheduleID
	}
	return v
}

func (s *server) registerGeneration() {
	s.jobs = newJobManager(s.store)
	admin := func(pattern string, h http.HandlerFunc) {
		s.handle(pattern, auth.Require(auth.RoleAdmin)(s.withStore(h)))
	}
	admin("POST /api/schedule-jobs", s.postScheduleJob)
	admin("GET /api/schedule-jobs", s.listScheduleJobs)
	admin("GET /api/schedule-jobs/{id}", s.getScheduleJob)
	admin("POST /api/schedule-jobs/{id}/stop", s.stopScheduleJob)
	admin("POST /api/schedule-jobs/{id}/continue", s.continueScheduleJob)
	admin("GET /api/schedules", s.listSchedules)
	admin("GET /api/schedules/{id}", s.getSchedule)
}

func (s *server) postScheduleJob(w http.ResponseWriter, r *http.Request) {
	var in generateInput
	if err := httpx.DecodeJSON(w, r, &in, maxBody); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := in.validate(); err != nil {
		s.writeError(w, err, opWrite)
		return
	}
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	job, err := s.jobs.start(principal.Actor(), in)
	if err != nil {
		if errors.Is(err, errJobsBusy) {
			w.Header().Set("Retry-After", "5")
			httpx.WriteError(w, http.StatusTooManyRequests, "jobs_busy", "the generation queue is full, retry shortly")
			return
		}
		s.logger.Error("cannot create generation job", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal", "cannot create generation job")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, job)
}

func (s *server) getScheduleJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validJobID(id) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "job id must be a 32-character hexadecimal id")
		return
	}
	job, ok := s.jobs.get(id)
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "schedule job not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, job)
}

func (s *server) listScheduleJobs(w http.ResponseWriter, r *http.Request) {
	s.read(w, r, func(ctx context.Context, q *db.Queries) (any, error) {
		rows, err := q.ListScheduleJobs(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]jobView, 0, len(rows))
		for i := range rows {
			out = append(out, scheduleJobFromDB(rows[i]))
		}
		return out, nil
	})
}

func (s *server) continueScheduleJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validJobID(id) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "job id must be a 32-character hexadecimal id")
		return
	}
	var in continueInput
	if !s.decode(w, r, &in) {
		return
	}
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	job, err := s.jobs.continueJob(r.Context(), principal.Actor(), id, in)
	if err != nil {
		s.writeError(w, err, opWrite)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, job)
}

func (s *server) stopScheduleJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validJobID(id) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "job id must be a 32-character hexadecimal id")
		return
	}
	if !s.jobs.stop(id) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "schedule job not found")
		return
	}
	job, _ := s.jobs.get(id)
	httpx.WriteJSON(w, http.StatusOK, job)
}

func validJobID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}
