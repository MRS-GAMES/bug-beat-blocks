CREATE TABLE IF NOT EXISTS monthly_players (
    month_key TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    player_name TEXT NOT NULL,
    claim_ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (month_key, device_hash),
    UNIQUE (month_key, player_name)
);

CREATE TABLE IF NOT EXISTS monthly_records (
    month_key TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    best_score INTEGER NOT NULL DEFAULT 0,
    score_run_level INTEGER NOT NULL DEFAULT 1,
    best_level INTEGER NOT NULL DEFAULT 1,
    level_run_score INTEGER NOT NULL DEFAULT 0,
    score_recorded_at INTEGER NOT NULL,
    level_recorded_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (month_key, device_hash),
    FOREIGN KEY (month_key, device_hash)
        REFERENCES monthly_players (month_key, device_hash)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_sessions (
    token_hash TEXT PRIMARY KEY,
    month_key TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    result_score INTEGER,
    result_level INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monthly_records_score
    ON monthly_records (month_key, best_score DESC, score_run_level DESC, score_recorded_at ASC);

CREATE INDEX IF NOT EXISTS idx_monthly_records_level
    ON monthly_records (month_key, best_level DESC, level_run_score DESC, level_recorded_at ASC);

CREATE INDEX IF NOT EXISTS idx_monthly_players_ip_created
    ON monthly_players (claim_ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_play_sessions_device_created
    ON play_sessions (device_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_play_sessions_ip_created
    ON play_sessions (ip_hash, created_at DESC);
