-- +goose Up

CREATE TABLE weight_profiles (
    id         BIGSERIAL   PRIMARY KEY,
    name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    weights    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX weight_profiles_name_idx ON weight_profiles (name);

ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS weight_profile_id BIGINT REFERENCES weight_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS weights_snapshot  JSONB;

INSERT INTO weight_profiles (name, weights)
VALUES ('По умолчанию',
        '{"gaps":5,"corpus_transitions":5,"teacher_compactness":1,"min_working_days":2,"curriculum_compactness":2,"room_stability":1,"room_capacity_waste":1,"edge_slots":2,"room_count":0,"teacher_preferences":5}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- +goose Down

ALTER TABLE schedules
    DROP COLUMN IF EXISTS weights_snapshot,
    DROP COLUMN IF EXISTS weight_profile_id;

DROP TABLE IF EXISTS weight_profiles;
