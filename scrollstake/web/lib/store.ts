import { randomBytes } from "crypto";
import type { Member, Session } from "./types";

// In-memory store for the hackathon. Kept on globalThis so Next.js dev reloads don't wipe it.
type InternalSession = Session & { tokens: Record<string, string> }; // wallet -> clientToken

const g = globalThis as unknown as { __scrollstake?: Map<string, InternalSession> };
const sessions = (g.__scrollstake ??= new Map<string, InternalSession>());

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function newCode(): string {
  let code = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return sessions.has(code) ? newCode() : code;
}

export function createSession(input: {
  creatorWallet: string;
  stakeUsdc: number;
  penaltyUsdc: number;
  lives: number;
}): Session {
  const s: InternalSession = {
    code: newCode(),
    ...input,
    createdAt: Date.now(),
    members: [],
    tokens: {},
  };
  sessions.set(s.code, s);
  return publicView(s);
}

export function getSession(code: string): Session | undefined {
  const s = sessions.get(code.toUpperCase());
  return s ? publicView(s) : undefined;
}

export function joinSession(code: string, wallet: string, name: string) {
  const s = sessions.get(code.toUpperCase());
  if (!s) return undefined;
  let member = s.members.find((m) => m.wallet === wallet);
  if (!member) {
    member = {
      wallet,
      name,
      livesLeft: s.lives,
      strikes: 0,
      slashedUsdc: 0,
      lastEventAt: 0,
    };
    s.members.push(member);
  }
  const token = (s.tokens[wallet] ??= randomBytes(16).toString("hex"));
  return { clientToken: token, session: publicView(s) };
}

/** Returns the live (mutable) member if the token matches, else undefined. */
export function authMember(code: string, wallet: string, token: string | null): { session: InternalSession; member: Member } | undefined {
  const s = sessions.get(code.toUpperCase());
  if (!s || !token || s.tokens[wallet] !== token) return undefined;
  const member = s.members.find((m) => m.wallet === wallet);
  return member ? { session: s, member } : undefined;
}

function publicView(s: InternalSession): Session {
  const { tokens: _tokens, ...rest } = s;
  return JSON.parse(JSON.stringify(rest));
}
