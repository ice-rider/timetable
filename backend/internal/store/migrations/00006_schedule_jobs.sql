-- +goose Up

CREATE TABLE schedule_jobs (
    id                    text        PRIMARY KEY,
    name                  text        NOT NULL,
    status                text        NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
    stage                 text        NOT NULL DEFAULT '',
    progress              integer     NOT NULL DEFAULT 0,
    lessons               integer     NOT NULL DEFAULT 0,
    placed                integer     NOT NULL DEFAULT 0,
    hard_violations       integer     NOT NULL DEFAULT 0,
    soft_penalty          double precision NOT NULL DEFAULT 0,
    steps                 bigint      NOT NULL DEFAULT 0,
    elapsed               text        NOT NULL DEFAULT '',
    budget_seconds        integer     NOT NULL,
    seed                  bigint      NOT NULL DEFAULT 0,
    error                 text,

    schedule_id           bigint      REFERENCES schedules(id) ON DELETE SET NULL,
    weight_profile_id     bigint      REFERENCES weight_profiles(id) ON DELETE SET NULL,
    weights_snapshot      jsonb,
    preview               jsonb,
    result                jsonb,

    continuation_of       text        REFERENCES schedule_jobs(id) ON DELETE SET NULL,
    continue_from_schedule_id bigint   REFERENCES schedules(id) ON DELETE SET NULL,
    attempt               integer     NOT NULL DEFAULT 1,
    total_budget_seconds  integer,
    stop_when_zero        boolean     NOT NULL DEFAULT false,
    stageb_state          jsonb,
    checkpoint_at         timestamptz,

    created_at            timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    finished_at           timestamptz,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX schedule_jobs_status_idx ON schedule_jobs(status);
CREATE INDEX schedule_jobs_created_at_idx ON schedule_jobs(created_at DESC);
CREATE INDEX schedule_jobs_schedule_id_idx ON schedule_jobs(schedule_id);
CREATE INDEX schedule_jobs_weight_profile_id_idx ON schedule_jobs(weight_profile_id);

-- +goose Down

DROP TABLE schedule_jobs;
