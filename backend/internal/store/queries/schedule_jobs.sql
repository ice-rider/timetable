-- name: UpsertScheduleJob :one
INSERT INTO schedule_jobs (
    id, name, status, stage, progress, lessons, placed, hard_violations, soft_penalty, steps, elapsed,
    budget_seconds, seed, error, schedule_id, weight_profile_id, weights_snapshot, preview, result,
    continuation_of, continue_from_schedule_id, attempt, total_budget_seconds, stop_when_zero,
    stageb_state, checkpoint_at, created_at, started_at, finished_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
    $22, $23, $24, $25, $26, COALESCE($27, now()), $28, $29, now()
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    stage = EXCLUDED.stage,
    progress = EXCLUDED.progress,
    lessons = EXCLUDED.lessons,
    placed = EXCLUDED.placed,
    hard_violations = EXCLUDED.hard_violations,
    soft_penalty = EXCLUDED.soft_penalty,
    steps = EXCLUDED.steps,
    elapsed = EXCLUDED.elapsed,
    budget_seconds = EXCLUDED.budget_seconds,
    seed = EXCLUDED.seed,
    error = EXCLUDED.error,
    schedule_id = EXCLUDED.schedule_id,
    weight_profile_id = EXCLUDED.weight_profile_id,
    weights_snapshot = EXCLUDED.weights_snapshot,
    preview = EXCLUDED.preview,
    result = EXCLUDED.result,
    continuation_of = EXCLUDED.continuation_of,
    continue_from_schedule_id = EXCLUDED.continue_from_schedule_id,
    attempt = EXCLUDED.attempt,
    total_budget_seconds = EXCLUDED.total_budget_seconds,
    stop_when_zero = EXCLUDED.stop_when_zero,
    stageb_state = EXCLUDED.stageb_state,
    checkpoint_at = EXCLUDED.checkpoint_at,
    started_at = EXCLUDED.started_at,
    finished_at = EXCLUDED.finished_at,
    updated_at = now()
RETURNING *;

-- name: GetScheduleJob :one
SELECT * FROM schedule_jobs WHERE id = $1;

-- name: ListScheduleJobs :many
SELECT * FROM schedule_jobs ORDER BY created_at DESC, id DESC;
