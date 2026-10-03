-- Run once against your Tiger Data / Postgres instance.
CREATE TABLE IF NOT EXISTS events (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  code         TEXT NOT NULL,
  wallet       TEXT NOT NULL,
  name         TEXT,
  status       TEXT NOT NULL,          -- forgiven | slashed | error
  reason       TEXT,
  duration_sec DOUBLE PRECISION,
  penalty_usdc DOUBLE PRECISION DEFAULT 0,
  tx_sig       TEXT
);

-- Tiger Data (TimescaleDB) stretch goal: make it a hypertable + continuous aggregate.
-- SELECT create_hypertable('events', 'ts', if_not_exists => TRUE);
--
-- CREATE MATERIALIZED VIEW IF NOT EXISTS flakes_per_minute
-- WITH (timescaledb.continuous) AS
-- SELECT time_bucket('1 minute', ts) AS bucket, code, wallet,
--        count(*) FILTER (WHERE status = 'slashed') AS slashes
-- FROM events GROUP BY bucket, code, wallet;
