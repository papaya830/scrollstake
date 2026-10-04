import { Pool } from "pg";

// Optional Postgres (Tiger Data). If DATABASE_URL is unset we just log to the console.
let pool: Pool | null = null;
// A configured database can still be unreachable (common in frontend-only deploys).
// Once a query fails, keep the request path on the in-memory fallback instead of
// repeatedly turning every API call into a 500.
const dbState = globalThis as typeof globalThis & { __scrollstakeDatabaseUnavailable?: boolean };
const databaseUrl = () => process.env.DATABASE_URL ?? process.env.TIMESCALE_SERVICE_URL;
export const databaseEnabled = () => Boolean(databaseUrl()) && !dbState.__scrollstakeDatabaseUnavailable;
/**
 * Serverless function memory is not shared between Vercel invocations. Keep it
 * for local development and unit tests, but never let it impersonate a shared
 * room in a deployed app. SCROLLSTAKE_ALLOW_MEMORY_STORE is an escape hatch for
 * a deliberately single-instance preview only.
 */
export const persistentDatabaseRequired = () => process.env.VERCEL === "1" && process.env.SCROLLSTAKE_ALLOW_MEMORY_STORE !== "1";
function getPool(): Pool | null {
  const connectionString = databaseUrl();
  if (!connectionString) return null;
  // Tiger Cloud service URLs include sslmode=require. pg treats that URL option
  // as higher priority than the explicit TLS object, so remove it before using
  // the same certificate handling as the rest of this hackathon app.
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return (pool ??= new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } }));
}

/** Shared by the session repository; never call it unless DATABASE_URL is configured. */
export async function dbQuery(text: string, values: unknown[] = []) {
  const active = getPool();
  if (!active) throw new Error("DATABASE_URL is required for database queries");
  try {
    return await active.query(text, values);
  } catch (error) {
    dbState.__scrollstakeDatabaseUnavailable = true;
    console.error("[db] database disabled after query failure", error);
    throw error;
  }
}

export type LoggedEvent = {
  code: string;
  wallet: string;
  name?: string;
  status: string;
  reason?: string;
  durationSec?: number;
  penaltyUsdc?: number;
  txSig?: string;
  source?: string;
  eventKind?: "heartbeat" | "distraction";
};

export type FocusPulsePoint = { bucket: string; wallet: string; focusedSamples: number; distractions: number; forgiven: number; slashes: number; penaltyUsdc: number };
export type FocusPulseMember = { wallet: string; name: string; focusedSamples: number; distractions: number; forgiven: number; slashes: number; penaltyUsdc: number };

export async function logEvent(e: LoggedEvent): Promise<void> {
  const p = getPool();
  if (!p) {
    console.log("[event]", JSON.stringify(e));
    return;
  }
  try {
    await p.query(
      `INSERT INTO events (code, wallet, name, status, event_kind, source, reason, duration_sec, penalty_usdc, tx_sig)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.code, e.wallet, e.name ?? null, e.status, e.eventKind ?? "distraction", e.source ?? "unknown", e.reason ?? null, e.durationSec ?? null, e.penaltyUsdc ?? 0, e.txSig ?? null]
    );
  } catch (err) {
    console.error("[db] logEvent failed", err); // never break the slash flow over logging
  }
}

export async function focusPulse(code: string): Promise<{ points: FocusPulsePoint[]; members: FocusPulseMember[] }> {
  const p = getPool();
  if (!p) return { points: [], members: [] };
  const [points, members] = await Promise.all([
    p.query(`SELECT bucket::text, wallet,
      focused_samples::int AS "focusedSamples", distractions::int AS distractions, forgiven::int AS forgiven,
      slashes::int AS slashes, penalty_usdc::float AS "penaltyUsdc"
      FROM focus_pulse_30s WHERE code = $1 AND bucket >= now() - interval '30 minutes' ORDER BY bucket, wallet`, [code.toUpperCase()]),
    p.query(`SELECT wallet, max(name) AS name,
      coalesce(sum(focused_samples), 0)::int AS "focusedSamples", coalesce(sum(distractions), 0)::int AS distractions,
      coalesce(sum(forgiven), 0)::int AS forgiven, coalesce(sum(slashes), 0)::int AS slashes,
      coalesce(sum(penalty_usdc), 0)::float AS "penaltyUsdc"
      FROM focus_pulse_30s WHERE code = $1 AND bucket >= now() - interval '30 minutes'
      GROUP BY wallet ORDER BY "focusedSamples" DESC, slashes ASC`, [code.toUpperCase()]),
  ]);
  return { points: points.rows as FocusPulsePoint[], members: members.rows as FocusPulseMember[] };
}

export async function leaderboard(code: string) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT wallet, max(name) AS name,
            count(*) FILTER (WHERE status = 'slashed')::int AS strikes,
            coalesce(sum(penalty_usdc) FILTER (WHERE status = 'slashed'), 0)::float AS "slashedUsdc"
       FROM events WHERE code = $1 GROUP BY wallet ORDER BY strikes DESC`,
    [code.toUpperCase()]
  );
  return rows;
}
