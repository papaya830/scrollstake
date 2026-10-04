import { randomBytes } from "crypto";
import { databaseEnabled, dbQuery, persistentDatabaseRequired } from "./db";
import type { Member, MembershipStatus, MonitoringPolicy, Session, SessionStatus } from "./types";

type InternalSession = Session & { tokens: Record<string, string> };
type SessionInput = { creatorWallet: string; stakeUsdc: number; penaltyUsdc: number; lives: number; durationMinutes?: number; allowedResources?: string[] };
const g = globalThis as unknown as { __scrollstake?: Map<string, InternalSession> };
const sessions = (g.__scrollstake ??= new Map<string, InternalSession>());
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_POLICY: MonitoringPolicy = { allowedResources: [], graceSeconds: 10, sampleIntervalSeconds: 3 };

export class PersistentStoreUnavailableError extends Error {
  constructor() {
    super("Shared sessions need DATABASE_URL (or TIMESCALE_SERVICE_URL) in this Vercel deployment. Configure Postgres and run web/db/schema.sql, then try again.");
    this.name = "PersistentStoreUnavailableError";
  }
}

function requireAvailableStore() {
  if (!databaseEnabled() && persistentDatabaseRequired()) throw new PersistentStoreUnavailableError();
}

function newCode(): string { const bytes = randomBytes(6); return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join(""); }
function publicView(s: InternalSession): Session { const { tokens: _tokens, ...rest } = s; return JSON.parse(JSON.stringify(rest)) as Session; }
function stamp(value: unknown): number | undefined { return value ? (value instanceof Date ? value.getTime() : new Date(String(value)).getTime()) : undefined; }
function memberFromRow(row: Record<string, unknown>): Member {
  return { wallet: String(row.wallet), name: String(row.name), livesLeft: Number(row.lives_left), strikes: Number(row.strikes), slashedUsdc: Number(row.slashed_usdc), lastEventAt: stamp(row.last_event_at) ?? 0, membershipStatus: row.membership_status as MembershipStatus, depositedAt: stamp(row.deposited_at), depositTx: row.deposit_tx ? String(row.deposit_tx) : undefined };
}
function sessionFromRow(row: Record<string, unknown>, members: Member[]): Session {
  return { code: String(row.code), creatorWallet: String(row.creator_wallet), stakeUsdc: Number(row.stake_usdc), penaltyUsdc: Number(row.penalty_usdc), lives: Number(row.lives), createdAt: stamp(row.created_at) ?? Date.now(), members, status: row.status as SessionStatus, durationMinutes: Number(row.duration_minutes), startsAt: stamp(row.starts_at), endsAt: stamp(row.ends_at), endedAt: stamp(row.ended_at), endReason: row.end_reason ? String(row.end_reason) : undefined, chainReady: Boolean(row.chain_ready), groupTx: row.group_tx ? String(row.group_tx) : undefined, monitoringPolicy: { allowedResources: Array.isArray(row.allowed_resources) ? row.allowed_resources.map(String) : [], graceSeconds: Number(row.grace_seconds), sampleIntervalSeconds: Number(row.sample_interval_seconds) } };
}
async function loadDbSession(code: string, includeTokens = false): Promise<(Session & { tokens?: Record<string, string> }) | undefined> {
  const base = await dbQuery("SELECT * FROM sessions WHERE code = $1", [code.toUpperCase()]);
  const row = base.rows[0] as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const fields = `wallet, name, lives_left, strikes, slashed_usdc, last_event_at, membership_status, deposited_at, deposit_tx${includeTokens ? ", client_token" : ""}`;
  const membersResult = await dbQuery(`SELECT ${fields} FROM session_members WHERE code = $1 ORDER BY joined_at`, [code.toUpperCase()]);
  const session = sessionFromRow(row, membersResult.rows.map((item) => memberFromRow(item as Record<string, unknown>))) as Session & { tokens?: Record<string, string> };
  if (includeTokens) session.tokens = Object.fromEntries(membersResult.rows.map((item) => [String(item.wallet), String(item.client_token ?? "")]));
  return session;
}

export async function createSession(input: SessionInput): Promise<Session> {
  requireAvailableStore();
  let code = newCode(); while (sessions.has(code)) code = newCode();
  const policy = { ...DEFAULT_POLICY, allowedResources: input.allowedResources ?? [] };
  const durationMinutes = [25, 50, 90, 120].includes(input.durationMinutes ?? 50) ? input.durationMinutes ?? 50 : 50;
  // Safe default: deployments must explicitly opt into sending transactions.
  const session: InternalSession = { code, creatorWallet: input.creatorWallet, stakeUsdc: input.stakeUsdc, penaltyUsdc: input.penaltyUsdc, lives: input.lives, createdAt: Date.now(), members: [], tokens: {}, status: "lobby", durationMinutes, chainReady: process.env.SOLANA_DRY_RUN !== "0", monitoringPolicy: policy };
  if (!databaseEnabled()) { sessions.set(code, session); return publicView(session); }
  try {
    await dbQuery(`INSERT INTO sessions (code, creator_wallet, stake_usdc, penalty_usdc, lives, created_at, status, duration_minutes, chain_ready, allowed_resources, grace_seconds, sample_interval_seconds) VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),$7,$8,$9,$10::jsonb,$11,$12)`, [code, input.creatorWallet, input.stakeUsdc, input.penaltyUsdc, input.lives, session.createdAt, "lobby", durationMinutes, session.chainReady, JSON.stringify(policy.allowedResources), policy.graceSeconds, policy.sampleIntervalSeconds]);
  } catch {
    requireAvailableStore();
    sessions.set(code, session);
  }
  return publicView(session);
}
async function readSession(code: string): Promise<Session | undefined> {
  requireAvailableStore();
  if (databaseEnabled()) return loadDbSession(code);
  const session = sessions.get(code.toUpperCase());
  return session ? publicView(session) : undefined;
}

/** Makes scheduled expiry authoritative even if the creator's browser is closed. */
export async function expireSessionIfDue(code: string, now = Date.now()): Promise<Session | undefined> {
  const session = await readSession(code);
  if (!session || session.status !== "live" || !session.endsAt || session.endsAt > now) return session;
  if (databaseEnabled()) {
    await dbQuery("UPDATE sessions SET status = 'ended', ended_at = to_timestamp($1 / 1000.0), end_reason = 'Scheduled timer complete' WHERE code = $2 AND status = 'live' AND ends_at <= to_timestamp($1 / 1000.0)", [now, code.toUpperCase()]);
  } else {
    const mutable = sessions.get(code.toUpperCase());
    if (mutable?.status === "live" && (mutable.endsAt ?? Infinity) <= now) Object.assign(mutable, { status: "ended", endedAt: now, endReason: "Scheduled timer complete" });
  }
  return readSession(code);
}

export async function getSession(code: string): Promise<Session | undefined> { return expireSessionIfDue(code); }

export async function joinSession(code: string, wallet: string, name: string) {
  requireAvailableStore();
  const normalized = code.toUpperCase();
  if (databaseEnabled()) {
    const existing = await loadDbSession(normalized, true) as (Session & { tokens: Record<string, string> }) | undefined;
    if (!existing || existing.status !== "lobby") return undefined;
    const current = existing.members.find((member) => member.wallet === wallet);
    const membershipStatus: MembershipStatus = current?.membershipStatus ?? (existing.creatorWallet === wallet ? "approved" : "pending");
    const token = existing.tokens[wallet] || randomBytes(16).toString("hex");
    await dbQuery(`INSERT INTO session_members (code, wallet, name, lives_left, membership_status, client_token) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code, wallet) DO UPDATE SET name = EXCLUDED.name`, [normalized, wallet, name, existing.lives, membershipStatus, token]);
    const session = await loadDbSession(normalized); return session ? { clientToken: membershipStatus === "approved" ? token : undefined, membershipStatus, session } : undefined;
  }
  const session = sessions.get(normalized); if (!session || session.status !== "lobby") return undefined;
  let member = session.members.find((item) => item.wallet === wallet);
  if (!member) { member = { wallet, name, livesLeft: session.lives, strikes: 0, slashedUsdc: 0, lastEventAt: 0, membershipStatus: session.creatorWallet === wallet ? "approved" : "pending" }; session.members.push(member); }
  const token = (session.tokens[wallet] ??= randomBytes(16).toString("hex"));
  return { clientToken: member.membershipStatus === "approved" ? token : undefined, membershipStatus: member.membershipStatus, session: publicView(session) };
}
export async function issueApprovedToken(code: string, wallet: string): Promise<string | undefined> {
  requireAvailableStore();
  if (databaseEnabled()) { const result = await dbQuery("SELECT client_token FROM session_members WHERE code = $1 AND wallet = $2 AND membership_status = 'approved'", [code.toUpperCase(), wallet]); return result.rows[0]?.client_token as string | undefined; }
  const session = sessions.get(code.toUpperCase()); return session?.members.find((member) => member.wallet === wallet)?.membershipStatus === "approved" ? session.tokens[wallet] : undefined;
}
export async function updateMembership(code: string, actorWallet: string, wallet: string, action: "approve" | "reject" | "remove") {
  requireAvailableStore();
  const session = await getSession(code); if (!session || session.status !== "lobby" || session.creatorWallet !== actorWallet || wallet === session.creatorWallet) return undefined;
  const next: MembershipStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "removed";
  if (databaseEnabled()) { const result = await dbQuery("UPDATE session_members SET membership_status = $1 WHERE code = $2 AND wallet = $3 RETURNING wallet", [next, code.toUpperCase(), wallet]); if (!result.rowCount) return undefined; }
  else { const member = sessions.get(code.toUpperCase())?.members.find((item) => item.wallet === wallet); if (!member) return undefined; member.membershipStatus = next; }
  return getSession(code);
}
export async function markDeposit(code: string, wallet: string, txSig: string) {
  requireAvailableStore();
  const session = await getSession(code), member = session?.members.find((item) => item.wallet === wallet);
  // A session created while real-chain mode was configured may not have a verified
  // group transaction. In dry-run mode a receipt is intentionally off-chain, so
  // allow that session to continue as a demo after switching modes.
  const requiresVerifiedGroup = process.env.SOLANA_DRY_RUN === "0";
  if (!session || session.status !== "lobby" || (requiresVerifiedGroup && !session.chainReady) || !member || member.membershipStatus !== "approved" || !txSig) return undefined;
  const now = Date.now();
  if (databaseEnabled()) await dbQuery("UPDATE session_members SET deposited_at = to_timestamp($1 / 1000.0), deposit_tx = $2 WHERE code = $3 AND wallet = $4", [now, txSig, code.toUpperCase(), wallet]);
  else { const mutable = sessions.get(code.toUpperCase())!.members.find((item) => item.wallet === wallet)!; mutable.depositedAt = now; mutable.depositTx = txSig; }
  return getSession(code);
}
export async function markChainReady(code: string, actorWallet: string, txSig: string) {
  requireAvailableStore();
  const session = await getSession(code);
  if (!session || session.status !== "lobby" || session.creatorWallet !== actorWallet || !txSig) return undefined;
  if (databaseEnabled()) await dbQuery("UPDATE sessions SET chain_ready = true, group_tx = $1 WHERE code = $2", [txSig, code.toUpperCase()]);
  else Object.assign(sessions.get(code.toUpperCase())!, { chainReady: true, groupTx: txSig });
  return getSession(code);
}
export async function startSession(code: string, actorWallet: string) {
  requireAvailableStore();
  const session = await getSession(code), approved = session?.members.filter((member) => member.membershipStatus === "approved") ?? [];
  if (!session || session.status !== "lobby" || session.creatorWallet !== actorWallet || !session.chainReady || !approved.length || approved.some((member) => !member.depositedAt)) return undefined;
  const startsAt = Date.now(), endsAt = startsAt + session.durationMinutes * 60_000;
  if (databaseEnabled()) await dbQuery("UPDATE sessions SET status = 'live', starts_at = to_timestamp($1 / 1000.0), ends_at = to_timestamp($2 / 1000.0) WHERE code = $3 AND status = 'lobby'", [startsAt, endsAt, code.toUpperCase()]);
  else Object.assign(sessions.get(code.toUpperCase())!, { status: "live", startsAt, endsAt }); return getSession(code);
}
export async function endSession(code: string, actorWallet: string, reason?: string) {
  requireAvailableStore();
  const session = await getSession(code); if (!session || session.status !== "live" || session.creatorWallet !== actorWallet) return undefined;
  const endedAt = Date.now();
  if (databaseEnabled()) await dbQuery("UPDATE sessions SET status = 'ended', ended_at = to_timestamp($1 / 1000.0), end_reason = $2 WHERE code = $3 AND status = 'live'", [endedAt, reason || null, code.toUpperCase()]);
  else Object.assign(sessions.get(code.toUpperCase())!, { status: "ended", endedAt, endReason: reason || undefined }); return getSession(code);
}
export async function authMember(code: string, wallet: string, token: string | null): Promise<{ session: Session; member: Member } | undefined> {
  requireAvailableStore();
  if (!token) return undefined;
  if (databaseEnabled()) {
    const session = await loadDbSession(code, true) as (Session & { tokens: Record<string, string> }) | undefined;
    const member = session?.members.find((item) => item.wallet === wallet);
    if (!session || member?.membershipStatus !== "approved" || session.tokens[wallet] !== token) return undefined;
    const current = await expireSessionIfDue(code);
    return current ? { session: current, member: current.members.find((item) => item.wallet === wallet)! } : undefined;
  }
  const session = sessions.get(code.toUpperCase()), member = session?.members.find((item) => item.wallet === wallet);
  if (!session || member?.membershipStatus !== "approved" || session.tokens[wallet] !== token) return undefined;
  const current = await expireSessionIfDue(code);
  return current ? { session: current, member: current.members.find((item) => item.wallet === wallet)! } : undefined;
}
async function mutateEvent(code: string, wallet: string, now: number, slash: boolean, penaltyUsdc = 0) {
  requireAvailableStore();
  if (databaseEnabled()) await dbQuery(slash ? "UPDATE session_members SET last_event_at = to_timestamp($1 / 1000.0), strikes = strikes + 1, slashed_usdc = slashed_usdc + $2 WHERE code = $3 AND wallet = $4" : "UPDATE session_members SET last_event_at = to_timestamp($1 / 1000.0), lives_left = lives_left - 1 WHERE code = $2 AND wallet = $3", slash ? [now, penaltyUsdc, code.toUpperCase(), wallet] : [now, code.toUpperCase(), wallet]);
  else { const member = sessions.get(code.toUpperCase())?.members.find((item) => item.wallet === wallet); if (!member) return undefined; member.lastEventAt = now; if (slash) { member.strikes += 1; member.slashedUsdc += penaltyUsdc; } else member.livesLeft -= 1; }
  return (await getSession(code))?.members.find((item) => item.wallet === wallet);
}
export const recordForgiven = (code: string, wallet: string, now: number) => mutateEvent(code, wallet, now, false);
export const recordSlash = (code: string, wallet: string, now: number, penaltyUsdc: number) => mutateEvent(code, wallet, now, true, penaltyUsdc);
export function resetMemoryStoreForTests() { sessions.clear(); }
