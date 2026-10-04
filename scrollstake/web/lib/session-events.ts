import { databaseEnabled, dbQuery, dbQuerySoft } from "./db";

export type WrappedEvent = {
  wallet: string;
  name?: string;
  kind: "heartbeat" | "forgiven" | "slashed";
  reason?: string;
  at: number;
  penaltyUsdc?: number;
};

const g = globalThis as typeof globalThis & { __scrollstakeEvents?: Map<string, WrappedEvent[]> };
const events = (g.__scrollstakeEvents ??= new Map<string, WrappedEvent[]>());
const MAX_EVENTS = 4000;

export function rememberSessionEvent(code: string, event: WrappedEvent) {
  const key = code.toUpperCase();
  const list = events.get(key) ?? [];
  list.push(event);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  events.set(key, list);
}

export function sessionEvents(code: string): WrappedEvent[] {
  return [...(events.get(code.toUpperCase()) ?? [])];
}

export function resetSessionEventsForTests() {
  events.clear();
}

type PulseRow = {
  bucket: string;
  wallet: string;
  name?: string;
  focusedSamples: number;
  forgiven: number;
  slashes: number;
  penaltyUsdc: number;
};

/** Turn Tiger's focus-pulse buckets into the same events the recap already understands. */
export function eventsFromPulse(points: PulseRow[]): WrappedEvent[] {
  const events: WrappedEvent[] = [];
  for (const point of points) {
    const start = Date.parse(point.bucket);
    const at = Number.isFinite(start) ? start : 0;
    for (let index = 0; index < point.focusedSamples; index += 1) {
      events.push({ wallet: point.wallet, name: point.name, kind: "heartbeat", at: at + index * 1000 });
    }
    for (let index = 0; index < point.forgiven; index += 1) {
      events.push({ wallet: point.wallet, name: point.name, kind: "forgiven", at: at + 200 + index });
    }
    const each = point.slashes ? point.penaltyUsdc / point.slashes : 0;
    for (let index = 0; index < point.slashes; index += 1) {
      events.push({ wallet: point.wallet, name: point.name, kind: "slashed", at: at + 500 + index, penaltyUsdc: each });
    }
  }
  return events.sort((left, right) => left.at - right.at);
}

function rowToEvent(row: Record<string, unknown>): WrappedEvent {
  return {
    wallet: String(row.wallet),
    name: row.name ? String(row.name) : undefined,
    kind: row.status as WrappedEvent["kind"],
    reason: row.reason ? String(row.reason) : undefined,
    at: Number(row.at),
    penaltyUsdc: Number(row.penaltyUsdc),
  };
}

/**
 * Tiger stores the room in `sessions` / `session_members` and the timeline in `events`.
 * The focus-pulse view is only a backup when the raw timeline is empty.
 * Memory is the fallback when this computer is not connected to Tiger.
 */
export async function loadWrappedEvents(code: string): Promise<{ events: WrappedEvent[]; source: "tiger" | "local" }> {
  const memory = sessionEvents(code);
  if (!databaseEnabled()) return { events: memory, source: "local" };
  const key = code.toUpperCase();
  try {
    const result = await dbQuery(
      `SELECT wallet, name, status, reason, (extract(epoch FROM ts) * 1000)::float8 AS at, coalesce(penalty_usdc, 0)::float8 AS "penaltyUsdc"
       FROM events WHERE code = $1 AND status IN ('heartbeat', 'forgiven', 'slashed') ORDER BY ts`,
      [key],
    );
    if (result.rows.length) return { events: result.rows.map((row) => rowToEvent(row as Record<string, unknown>)), source: "tiger" };
  } catch (error) {
    console.error("[wrapped] event query failed", error);
    return { events: memory, source: "local" };
  }
  const pulse = await dbQuerySoft(
    `SELECT bucket::text, wallet, max(name) AS name,
            coalesce(sum(focused_samples), 0)::int AS "focusedSamples",
            coalesce(sum(forgiven), 0)::int AS forgiven,
            coalesce(sum(slashes), 0)::int AS slashes,
            coalesce(sum(penalty_usdc), 0)::float8 AS "penaltyUsdc"
     FROM focus_pulse_30s WHERE code = $1 GROUP BY bucket, wallet ORDER BY bucket`,
    [key],
  );
  if (pulse?.rows.length) return { events: eventsFromPulse(pulse.rows as PulseRow[]), source: "tiger" };
  return { events: memory, source: memory.length ? "local" : "tiger" };
}

export type WrappedSnapshot = {
  wallet: string;
  name?: string;
  kind: "forgiven" | "slashed";
  reason?: string;
  at: number;
  camera?: string;
  screen?: string;
};

const MAX_SNAPSHOT_BYTES = 250_000;
const MAX_SNAPSHOTS = 60;
const gs = globalThis as typeof globalThis & { __scrollstakeSnapshots?: Map<string, WrappedSnapshot[]>; __scrollstakeSnapshotTable?: Promise<unknown> };
const snapshots = (gs.__scrollstakeSnapshots ??= new Map<string, WrappedSnapshot[]>());

export function cleanImage(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("data:image/jpeg;base64,") || value.length > MAX_SNAPSHOT_BYTES) return undefined;
  return value;
}

function ensureSnapshotTable() {
  return (gs.__scrollstakeSnapshotTable ??= dbQuerySoft(
    `CREATE TABLE IF NOT EXISTS wrapped_snapshots (
       id bigserial PRIMARY KEY, code text NOT NULL, wallet text NOT NULL, name text, kind text NOT NULL,
       reason text, ts timestamptz NOT NULL DEFAULT now(), camera text, screen text)`,
  ));
}

export async function saveSnapshot(code: string, snapshot: WrappedSnapshot) {
  if (!snapshot.camera && !snapshot.screen) return;
  const key = code.toUpperCase();
  const list = snapshots.get(key) ?? [];
  list.push(snapshot);
  if (list.length > MAX_SNAPSHOTS) list.splice(0, list.length - MAX_SNAPSHOTS);
  snapshots.set(key, list);
  if (!databaseEnabled()) return;
  await ensureSnapshotTable();
  await dbQuerySoft(
    `INSERT INTO wrapped_snapshots (code, wallet, name, kind, reason, ts, camera, screen) VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),$7,$8)`,
    [key, snapshot.wallet, snapshot.name ?? null, snapshot.kind, snapshot.reason ?? null, snapshot.at, snapshot.camera ?? null, snapshot.screen ?? null],
  );
}

export async function loadSnapshots(code: string): Promise<WrappedSnapshot[]> {
  const key = code.toUpperCase();
  const memory = [...(snapshots.get(key) ?? [])].sort((a, b) => b.at - a.at);
  if (!databaseEnabled()) return memory;
  await ensureSnapshotTable();
  const result = await dbQuerySoft(
    `SELECT wallet, name, kind, reason, (extract(epoch FROM ts) * 1000)::float8 AS at, camera, screen
     FROM wrapped_snapshots WHERE code = $1 ORDER BY ts DESC LIMIT $2`,
    [key, MAX_SNAPSHOTS],
  );
  if (!result?.rows.length) return memory;
  return result.rows.map((row) => ({
    wallet: String(row.wallet),
    name: row.name ? String(row.name) : undefined,
    kind: row.kind === "slashed" ? "slashed" : "forgiven",
    reason: row.reason ? String(row.reason) : undefined,
    at: Number(row.at),
    camera: row.camera ?? undefined,
    screen: row.screen ?? undefined,
  }));
}
