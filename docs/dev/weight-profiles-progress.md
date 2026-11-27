# Progress: soft-criterion weights, weight profiles, schedule_jobs (backend + frontend)

Date: 2026-11-26

Branch: `agents/frontend-backend-client-review` (uncommitted, not pushed).

## Objective

Apply configurable soft-criterion weights and weight profiles on the backend, expose them in
`SchedulerPage`, and persist `schedule_jobs` history for resumable schedule generation.

## Requirements (locked decisions)

- `weight` is an integer `>= 0`; `0` disables the criterion; negatives, fractions, `NaN`, `Inf`,
  `null`, strings and unknown keys are rejected; no `0..100` range and no `0..1` normalization.
- Effective weighted value: `weighted = value * weight`; soft total = sum of weighted values.
- Derived order: `order = weight desc`, ties stable; disabled (`weight = 0`) sinks to the bottom.
- Reorder uses integer midpoint `floor((upper+lower)/2)`; `+1` upper and everything above when no
  integer fits; minimum weight for enabled rows is `1`.
- Default weights come from `soft.DefaultWeights()`; current defaults keep `room_count = 0`.
- `weight_profile_id` is optional; raw `weights` are used when no saved profile is selected; the
  effective map is always stored as `weights_snapshot`.
- `localStorage` key `timetable-weight-last-positive` restores the last positive weight per criterion.

## Implemented so far

### Backend

- Migration `00005_weight_profiles.sql`: `weight_profiles` table, `schedules.weight_profile_id`,
  `schedules.weights_snapshot`, seed profile `По умолчанию`.
- Migration `00006_schedule_jobs.sql` (created but NOT applied to the running localhost yet):
  `schedule_jobs` table with `id text` primary key, `status`, `stage`, `progress`, `lessons`,
  `placed`, `hard_violations`, `soft_penalty`, `steps`, `elapsed`, `budget_seconds`, `seed`,
  `error`, `schedule_id`, `weight_profile_id`, `weights_snapshot`, `preview`, `result`,
  `continuation_of`, `continue_from_schedule_id`, `attempt`, `total_budget_seconds`,
  `stop_when_zero`, `stageb_state`, `checkpoint_at`, timestamps; indexes on status/created_at/
  schedule_id/weight_profile_id; CHECK on status.
- Queries: `weight_profiles.sql`, `schedule.sql` (`UpdateScheduleWeights`), `schedule_jobs.sql`
  (`UpsertScheduleJob`, `GetScheduleJob`, `ListScheduleJobs` — generated into
  `backend/internal/store/db`).
- `backend/internal/api/weight_profile.go`: `weightProfile`, `weightProfileInput`, `validate`
  (integer weights, unknown keys, negative, fractional, NaN/Inf), `toWeightProfile`, `toSoftWeights`,
  `weightsJSON`, `registerWeightProfiles` with `GET/POST/PUT/DELETE /api/weight-profiles`,
  `WeightProfileInUse` checks `schedules` AND `schedule_jobs` (`inUse.Bool`), `inUseError`.
- `backend/internal/api/review.go`: `POST /api/review` accepts `weight_profile_id` form value and
  optional weights via `review.WithWeights` / `review.AnalyzeOption`; falls back to defaults.
- `backend/internal/engine/soft`: `Weights [NumCriteria]float64`, `DefaultWeights`, `ParseCriterion`,
  `Breakdown.Total(w)`, `Breakdown.Weighted(w)`.
- `backend/internal/generation`: `Options.Weights`, `Options.WeightProfileID`, `Options.Resume`,
  `Options.StopWhenZero`; `Result.WeightsSnapshot`, `Result.WeightProfileID`, `Result.StageBState`;
  `Service.Generate` loads profile when only id is given, snapshots effective weights.
- `backend/internal/api/generation.go`: `generateInput` with `weights`, `weight_profile_id`,
  `stop_when_zero`, `total_budget_seconds`, `seed`, plus internal continuation fields;
  `jobManager` with `start` (in-memory job creation, `persistJob` into `schedule_jobs`),
  `run` (worker loop, persist progress/result, `stageBState`, `scheduleID`), `viewJob`,
  `hasWeightProfileInUse`; `weightsFromSnapshot`, `normalizeWeightSnapshot`, `scheduleJobFromDB`,
  `int64Ptr`, `weightsFromSnapshot` helper returning `*soft.Weights`.

### Frontend

- `frontend/src/pages/WeightProfileEditor.tsx`: `SOFT_CRITERIA`, `DEFAULT_WEIGHTS`,
  `Weights`, `normalizeWeights`, `makeRows`, `sortRows`, `toWeights`, `moveCriterion`,
  `WeightProfileEditor` component (checkbox/toggle, number input, up/down arrows, drag & drop with
  `dragKey`, `weight-help` tooltip, `equalHigh` warning, `weight-profile-save`, `weight-list`,
  `weight-row`, `weight-total`, `sr-only` live region).
- `frontend/src/pages/SchedulerPage.tsx`: `weights`, `selectedWeightProfileID`, `weightProfiles`
  query, `WeightProfileEditor`, `saveWeightProfile`, `removeWeightProfile` mutations, `startGeneration`
  passes `weight_profile_id` + `weights`; `putJSON`/`deleteJSON` client helpers.
- `frontend/src/api/scheduler.ts`: `WeightProfile`, `ScheduleCriterion`, `Schedule` (with `soft?`),
  `GenerationResult` (with `weights_snapshot?`), `GenerationJob` (with `weight_profile_id?`,
  `weights_snapshot?`).
- `frontend/src/scheduler.css`: styles for `.weight-profile-editor`, `.weight-profile-heading`,
  `.weight-total`, `.weight-profile-select`, `.weight-list`, `.weight-row`, `.weight-row.checked`,
  `.weight-row.disabled`, `.weight-row.drag-over`, `.weight-grip`, `.weight-name`, `.weight-title`,
  `.weight-key`, `.weight-help`, `.weight-arrows`, `.weight-input-label`, `.weight-order`,
  `.weight-warning`, `.weight-profile-save`, `.quiet-button.danger`, `.sr-only`, media query.

### Solver / state

- `backend/internal/solver/stageb/stageb.go`: `Options.Resume`, `Options.StopWhenZero`,
  `State{Step, Elapsed, Temperature, T0, TEnd, RNG, Current, Best}`, `mustRNG`, zero-moves branch
  saves best + state, `Run` honors resume temperatures/steps/elapsed, stops on
  `StopWhenZero && conflicts == 0 && soft.Total(w) == 0`.
- `backend/internal/generation/generation.go`: resume wiring for stage B, `StageBState` in result.

### OpenAPI / tests / tooling

- `backend/api/openapi.yaml`: `WeightProfile`, `WeightProfileInput`, weight profile CRUD paths,
  weight fields on `ScheduleJob`, `Schedule`, `POST /api/review` weight input.
- Checks run so far: `npm ci`, `npm run typecheck` (after fixing `lower` possibly null), `sqlc
  generate`, `gofmt`, `go test ./...` (after fixing `weightsFromSnapshot`, `inUse.Bool`,
  `toSoftWeights` test with fractional weights, `normalizeWeightSnapshot`), `go test ./internal/api
  ./internal/store/...`.
- Localhost: `docker compose -f deploy/docker-compose.yml -p timetable-weight-profiles` with
  `POSTGRES_PORT=55434`, `WEB_PORT=8081`, `ADMIN_LOGIN=admin`, `ADMIN_PASSWORD=admin123456`,
  `APP_ENV=dev`; migrations applied via `api` container restart; smoke-tested `schedule-jobs`,
  `schedules`, `review`, `in_use`.
- Known environment issue: `golangci-lint` fails with `panic: file requires newer Go version go1.27
  (application built with go1.26)`; use `go test ./...` for now.

## Remaining work (in progress)

1. Create this markdown progress file (done now).
2. Add `m.listScheduleJobs`, `m.continueScheduleJob`, routes `GET /api/schedule-jobs`,
   `POST /api/schedule-jobs/{id}/continue` (DONE in this session):
   - `backend/internal/api/generation.go` gained `listScheduleJobs` handler, `continueScheduleJob`
     handler, `jobManager.listJobs`, `jobManager.continueJob`, `jobManager.sourceJob`,
     `jobManager.getJob`, `jobFromDBRow`, converters, `continueInput` + `validateWeights`.
   - Routes registered: `GET /api/schedule-jobs`, `POST /api/schedule-jobs/{id}/continue`.
   - `GET /api/schedule-jobs` returns persisted history via `db.Queries.ListScheduleJobs`.
   - `POST /api/schedule-jobs/{id}/continue` loads source job (in-memory or `schedule_jobs` history),
     resumes from its `stageb_state`, creates a child job with `continuation_of` = source id,
     `continue_from_schedule_id` = source schedule id, `attempt` = source attempt + 1, weights from
     source `weights_snapshot` (+ optional body override).
3. Build `stageb.Resume` from `schedule_jobs.stageb_state` or `schedules`; restore
   `Current`, `Best`, `RNG`, `Step`, `Elapsed`, `T0`, `TEnd` (DONE: `stageb.New` restores RNG +
   Current + Best, `Run` restores T0/TEnd/Step/Elapsed; `generation.Solve` skips stage A on resume and
   reports initial progress after the optimizer restores the checkpoint).
4. Persist `schedule_jobs` `schedule_id`, `stageb_state`, `weights_snapshot`, `weight_profile_id`,
   `continuation_of`, `attempt`, `schedule` (DONE: `persistJob` writes all; `run` stores result
   state/schedule id; `scheduleJobFromDB` maps them into `jobView`).
5. Add `schedule.soft`, `schedule_jobs.soft`, `weighted`, `value`, `available` (DONE):
   - `generation.SoftCriterion` + `generation.Result.Soft` + `generation.SoftCriterias`.
   - `scheduleDetail.Soft` computed in `api/schedules.go` (`generation.SoftCriterias`).
   - `jobView.Soft` (from in-memory `viewJob` via `jobResultSoft`, and from DB row result).
6. Update `backend/api/openapi.yaml`; keep `TestSpecCoversRoutes` satisfied (DONE: added `GET
   /api/schedule-jobs`, `POST /api/schedule-jobs/{id}/continue`, `weights` on the start body, new
   `SoftCriterion` schema, `soft` on `Schedule`/`ScheduleJob`, continuation/stop/attempt/budget
   fields; api tests green).
7. `sqlc generate`, `gofmt`, `go test -race ./...`, `npm run typecheck`, `npm test`, `npm run lint`,
   restart `timetable-weight-profiles`, apply `00006`, verify (DONE for backend+frontend:
   go test -race clean, go vet clean, gofmt clean, sqlc generate OK, typecheck OK, vitest 19/19 OK,
   oxlint+prettier OK, go test ./... OK; docker api rebuilt + restarted, migration 00006 applied,
   smoke-tested jobs list/start/stop/continue/schedule + soft fields over HTTP).
8. Re-run `golangci-lint` with Go 1.27 tool or adjust version (IN PROGRESS: binary installed at
   `/home/gleb/go/bin/golangci-lint` is built with go1.26 and panics on go1.27 modules; a source
   install failed on an unreachable optional linter module. Fallback: `go vet ./...` is clean).

## Smoke verification (localhost, 2026-11-26)

- `GET /api/healthz` -> 200.
- `GET /api/schedule-jobs` (auth) -> 200, `[]`.
- `GET /api/weight-profiles` (auth) -> 200, `[{id:1,name:"По умолчанию",weights:{...}}]`.
- `POST /api/schedule-jobs {"name":"smoke-A","budget_seconds":2,"weights":{"gaps":3}}` -> 202,
  job `{"id":"2392...","status":"queued",...,"attempt":1,"weights_snapshot":{...gaps:3,...}}`.
- job ran to `completed` (411 lessons placed, 0 hard violations), response now carries
  `attempt`, `soft: [{key,title,value,weight,weighted,available}]`, `result.soft` alike.
- `POST /api/schedule-jobs/{id}/continue {"budget_seconds":2}` -> 202 with
  `continuation_of` = source id, `attempt` = source attempt + 1, weights inherited.
- bad job id -> 400 `invalid_request`; unknown job -> 404 `not_found`.
- `GET /api/schedules/{id}` -> 200 with `soft` array + `weights_snapshot`.

## Known environment issues

- `golangci-lint` (v2.12.2 binary) is incompatible with the go1.27 toolchain; use `go vet` / `go test`.
- Localhost postgres was recreated during `--build api` (compose side effect); dev data re-seeded by
  subsequent smoke runs; migrations re-applied through goose version 6.


## Next steps log (short)

- `schedule_jobs` GET history and continue endpoint were the last task focus.
- `stageb.State` JSON round-trip fields: `Step`, `Elapsed`, `Temperature`, `T0`, `TEnd`, `RNG`,
  `Current`, `Best`; snapshot fields `Assignments`, `Cost`, `Soft`, `Changes`, `HardViolations`,
  `Step`, `Elapsed`.
- `engine.Assignment{Placed, Slot, Room, Pinned}` and `domain.Slot{Day, Period, Parity}` round-trip
  through encoding/json with Go field names.
- `stageb.New` restores RNG (`o.pcg.UnmarshalBinary(r.RNG)`), `Current`, `Best`; `Run` restores
  `T0/TEnd/Step/Elapsed` from resume and keeps `Best`/`Current`.
- `stageb.StopWhenZero` stops when hard conflicts and weighted soft penalty are both zero.
