package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/istu-pro-dev/timetable/backend/internal/auth"
	"github.com/istu-pro-dev/timetable/backend/internal/generation"
	"github.com/istu-pro-dev/timetable/backend/internal/httpx"
	"github.com/istu-pro-dev/timetable/backend/internal/store"
)

const (
	maxGenerationJobs = 8
	maxGenerationTime = 5 * time.Minute
)

var errJobsBusy = errors.New("generation queue is full")

type generateInput struct {
	Name          string `json:"name"`
	BudgetSeconds int    `json:"budget_seconds"`
	Seed          uint64 `json:"seed"`
}

func (in *generateInput) validate() error {
	var v validator
	v.text("name", &in.Name, 0, 120)
	if in.BudgetSeconds == 0 {
		in.BudgetSeconds = 30
	}
	v.between("budget_seconds", int64(in.BudgetSeconds), 1, int64(maxGenerationTime/time.Second))
	return v.err()
}

type generationJob struct {
	mu            sync.RWMutex
	id            string
	status        string
	budgetSeconds int
	progress      generation.Progress
	result        *generation.Result
	err           string
	cancel        context.CancelFunc
}

type jobView struct {
	ID             string              `json:"id"`
	Status         string              `json:"status"`
	Stage          string              `json:"stage"`
	Progress       int                 `json:"progress"`
	Lessons        int                 `json:"lessons"`
	Placed         int                 `json:"placed"`
	HardViolations int                 `json:"hard_violations"`
	SoftPenalty    float64             `json:"soft_penalty"`
	Steps          int64               `json:"steps"`
	Elapsed        string              `json:"elapsed"`
	BudgetSeconds  int                 `json:"budget_seconds"`
	Preview        *generation.Preview `json:"preview,omitempty"`
	ScheduleID     int64               `json:"schedule_id,omitempty"`
	Result         *generation.Result  `json:"result,omitempty"`
	Error          string              `json:"error,omitempty"`
}

type jobManager struct {
	mu      sync.RWMutex
	jobs    map[string]*generationJob
	workers chan struct{}
	service *generation.Service
}

func newJobManager(st *store.Store) *jobManager {
	return &jobManager{
		jobs: make(map[string]*generationJob), workers: make(chan struct{}, 1),
		service: generation.New(st),
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
		id: id, status: "queued", budgetSeconds: in.BudgetSeconds, cancel: cancel,
	}
	m.jobs[id] = job
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
		job.mu.Unlock()
		return
	}

	if ctx.Err() != nil {
		job.mu.Lock()
		job.status = "cancelled"
		job.mu.Unlock()
		return
	}

	job.mu.Lock()
	job.status = "running"
	job.mu.Unlock()
	result, err := m.service.Generate(ctx, actor, generation.Options{
		Name: in.Name, Budget: time.Duration(in.BudgetSeconds) * time.Second, Seed: in.Seed,
	}, func(p generation.Progress) {
		job.mu.Lock()
		job.progress = p
		job.mu.Unlock()
	})
	job.mu.Lock()
	defer job.mu.Unlock()
	switch {
	case err != nil:
		job.status = "failed"
		job.err = err.Error()
	case result.Cancelled || ctx.Err() != nil:
		result.Cancelled = true
		job.status = "cancelled"
		job.result = &result
	case result.ScheduleID > 0:
		job.status = "completed"
		job.result = &result
	default:
		job.status = "failed"
		job.err = "generation finished without a saved schedule"
	}
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

func viewJob(job *generationJob) jobView {
	job.mu.RLock()
	defer job.mu.RUnlock()
	v := jobView{
		ID: job.id, Status: job.status, Stage: job.progress.Stage, Progress: job.progress.Percent,
		Lessons: job.progress.Lessons, Placed: job.progress.Placed,
		HardViolations: job.progress.HardViolations, SoftPenalty: job.progress.SoftPenalty,
		Steps: job.progress.Steps, Elapsed: job.progress.Elapsed, BudgetSeconds: job.budgetSeconds,
		Preview: job.progress.Preview, Error: job.err,
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
	admin("GET /api/schedule-jobs/{id}", s.getScheduleJob)
	admin("POST /api/schedule-jobs/{id}/stop", s.stopScheduleJob)
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
