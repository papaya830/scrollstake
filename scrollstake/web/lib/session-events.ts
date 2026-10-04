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
