import { Pool } from "pg";

// Optional Postgres (Tiger Data). If DATABASE_URL is unset we just log to the console.
let pool: Pool | null = null;
function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  return (pool ??= new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }));
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
};

export async function logEvent(e: LoggedEvent): Promise<void> {
  const p = getPool();
  if (!p) {
    console.log("[event]", JSON.stringify(e));
    return;
  }
  try {
    await p.query(
      `INSERT INTO events (code, wallet, name, status, reason, duration_sec, penalty_usdc, tx_sig)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.code, e.wallet, e.name ?? null, e.status, e.reason ?? null, e.durationSec ?? null, e.penaltyUsdc ?? 0, e.txSig ?? null]
    );
  } catch (err) {
    console.error("[db] logEvent failed", err); // never break the slash flow over logging
  }
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
