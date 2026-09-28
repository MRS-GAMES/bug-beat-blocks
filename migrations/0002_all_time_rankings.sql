CREATE TABLE IF NOT EXISTS players (
    device_hash TEXT PRIMARY KEY,
    player_name TEXT NOT NULL UNIQUE,
    claim_ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS all_time_records (
    device_hash TEXT PRIMARY KEY,
    best_score INTEGER NOT NULL DEFAULT 0,
    score_run_level INTEGER NOT NULL DEFAULT 1,
    best_level INTEGER NOT NULL DEFAULT 1,
    level_run_score INTEGER NOT NULL DEFAULT 0,
    score_recorded_at INTEGER NOT NULL,
    level_recorded_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (device_hash)
        REFERENCES players (device_hash)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Keep the most recently used name for each device. If an old monthly name is
-- already owned by another device, the most recently updated owner keeps it.
INSERT OR IGNORE INTO players (
    device_hash, player_name, claim_ip_hash, created_at, updated_at
)
SELECT device_hash, player_name, claim_ip_hash, created_at, updated_at
FROM monthly_players
ORDER BY updated_at DESC;

-- Carry each migrated device's best score and best level into the all-time table.
WITH
score_rows AS (
    SELECT
        r.*,
        ROW_NUMBER() OVER (
            PARTITION BY r.device_hash
            ORDER BY r.best_score DESC, r.score_run_level DESC,
                     r.score_recorded_at ASC, r.month_key ASC
        ) AS position
    FROM monthly_records r
    JOIN players p ON p.device_hash = r.device_hash
),
level_rows AS (
    SELECT
        r.*,
        ROW_NUMBER() OVER (
            PARTITION BY r.device_hash
            ORDER BY r.best_level DESC, r.level_run_score DESC,
                     r.level_recorded_at ASC, r.month_key ASC
        ) AS position
    FROM monthly_records r
    JOIN players p ON p.device_hash = r.device_hash
)
INSERT OR IGNORE INTO all_time_records (
    device_hash, best_score, score_run_level, best_level, level_run_score,
    score_recorded_at, level_recorded_at, updated_at
)
SELECT
    score_rows.device_hash,
    score_rows.best_score,
    score_rows.score_run_level,
    level_rows.best_level,
    level_rows.level_run_score,
    score_rows.score_recorded_at,
    level_rows.level_recorded_at,
    MAX(score_rows.updated_at, level_rows.updated_at)
FROM score_rows
JOIN level_rows ON level_rows.device_hash = score_rows.device_hash
WHERE score_rows.position = 1 AND level_rows.position = 1;

CREATE INDEX IF NOT EXISTS idx_players_ip_created
    ON players (claim_ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_all_time_records_score
    ON all_time_records (best_score DESC, score_run_level DESC, score_recorded_at ASC);

CREATE INDEX IF NOT EXISTS idx_all_time_records_level
    ON all_time_records (best_level DESC, level_run_score DESC, level_recorded_at ASC);
