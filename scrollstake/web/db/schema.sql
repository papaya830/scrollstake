-- Run once against your Tiger Data / Postgres instance.
CREATE TABLE IF NOT EXISTS sessions (
  code TEXT PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  stake_usdc DOUBLE PRECISION NOT NULL,
  penalty_usdc DOUBLE PRECISION NOT NULL,
  lives INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('lobby', 'live', 'ended')),
  duration_minutes INTEGER NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  allowed_resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  grace_seconds INTEGER NOT NULL DEFAULT 10,
  sample_interval_seconds INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS session_members (
  code TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  lives_left INTEGER NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0,
  slashed_usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  membership_status TEXT NOT NULL CHECK (membership_status IN ('pending', 'approved', 'rejected', 'removed')),
  deposited_at TIMESTAMPTZ,
  deposit_tx TEXT,
  client_token TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, wallet)
);

CREATE INDEX IF NOT EXISTS session_members_code_idx ON session_members (code, membership_status);

CREATE TABLE IF NOT EXISTS events (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  code         TEXT NOT NULL,
  wallet       TEXT NOT NULL,
  name         TEXT,
  status       TEXT NOT NULL,          -- heartbeat | forgiven | slashed | error
  event_kind   TEXT NOT NULL DEFAULT 'distraction',
  source       TEXT NOT NULL DEFAULT 'unknown',
  reason       TEXT,
  duration_sec DOUBLE PRECISION,
  penalty_usdc DOUBLE PRECISION DEFAULT 0,
  tx_sig       TEXT
);

-- Safe when upgrading a database created with the old event table.
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'distraction';
ALTER TABLE events ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown';

-- Tiger Data: time-partition monitoring telemetry while retaining ordinary SQL.
SELECT create_hypertable('events', 'ts', if_not_exists => TRUE, migrate_data => TRUE);

-- Live dashboard aggregate. materialized_only=false includes the current raw bucket.
CREATE MATERIALIZED VIEW IF NOT EXISTS focus_pulse_30s
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '30 seconds', ts) AS bucket,
  code,
  wallet,
  max(name) AS name,
  count(*) FILTER (WHERE event_kind = 'heartbeat') AS focused_samples,
  count(*) FILTER (WHERE event_kind = 'distraction') AS distractions,
  count(*) FILTER (WHERE status = 'forgiven') AS forgiven,
  count(*) FILTER (WHERE status = 'slashed') AS slashes,
  coalesce(sum(penalty_usdc) FILTER (WHERE status = 'slashed'), 0) AS penalty_usdc,
  avg(duration_sec) FILTER (WHERE event_kind = 'distraction') AS avg_distraction_duration_sec
FROM events
GROUP BY bucket, code, wallet;

SELECT add_continuous_aggregate_policy(
  'focus_pulse_30s',
  start_offset => INTERVAL '1 hour',
  end_offset => INTERVAL '30 seconds',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE
);
