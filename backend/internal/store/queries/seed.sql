-- name: TruncateSeedData :exec
TRUNCATE assignment_audience, assignments, schedule_jobs, schedules, lessons, curriculum_audience,
    curriculum_items, room_availability, rooms, buildings, room_types, periods, time_grid,
    teacher_availability
    RESTART IDENTITY;

-- name: DeleteSeedGroups :exec
DELETE FROM groups;

-- name: DeleteSeedTeachers :exec
DELETE FROM teachers;

-- name: DeleteSeedDisciplines :exec
DELETE FROM disciplines;

-- name: ResetSeedGroupIDs :exec
ALTER TABLE groups ALTER COLUMN id RESTART WITH 1;

-- name: ResetSeedSubgroupIDs :exec
ALTER TABLE subgroups ALTER COLUMN id RESTART WITH 1;

-- name: ResetSeedTeacherIDs :exec
ALTER TABLE teachers ALTER COLUMN id RESTART WITH 1;

-- name: ResetSeedDisciplineIDs :exec
ALTER TABLE disciplines ALTER COLUMN id RESTART WITH 1;
