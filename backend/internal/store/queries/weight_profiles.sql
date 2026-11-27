-- name: ListWeightProfiles :many
SELECT id, name, weights, created_at, updated_at FROM weight_profiles ORDER BY name;

-- name: GetWeightProfile :one
SELECT id, name, weights, created_at, updated_at FROM weight_profiles WHERE id = $1;

-- name: CreateWeightProfile :one
INSERT INTO weight_profiles (name, weights) VALUES ($1, $2)
RETURNING id, name, weights, created_at, updated_at;

-- name: UpdateWeightProfile :one
UPDATE weight_profiles SET name = $2, weights = $3, updated_at = now()
WHERE id = $1 RETURNING id, name, weights, created_at, updated_at;

-- name: DeleteWeightProfile :execrows
DELETE FROM weight_profiles WHERE id = $1;

-- name: WeightProfileInUse :one
SELECT (
    EXISTS(SELECT 1 FROM schedules WHERE schedules.weight_profile_id = $1) OR
    EXISTS(SELECT 1 FROM schedule_jobs WHERE schedule_jobs.weight_profile_id = $1)
);
