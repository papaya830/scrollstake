export type Member = {
  wallet: string;
  name: string;
  livesLeft: number;
  strikes: number;
  slashedUsdc: number;
  lastEventAt: number;
  membershipStatus?: "pending" | "approved" | "rejected" | "removed";
  depositedAt?: number;
  depositTx?: string;
};

export type SessionStatus = "lobby" | "live" | "ended";

export type SessionView = {
  code: string;
  creatorWallet: string;
  stakeUsdc: number;
  penaltyUsdc: number;
  lives: number;
  createdAt: number;
  members: Member[];
  status?: SessionStatus;
  durationMinutes?: 25 | 50 | 90 | 120;
  startsAt?: number;
  endsAt?: number;
  endedAt?: number;
  endReason?: string;
  monitoringPolicy?: { allowedResources: string[]; graceSeconds?: number; sampleIntervalSeconds?: number };
};

export type SessionAuth = { wallet: string; name: string; clientToken?: string; membershipStatus?: "pending" | "approved" };

export const authKey = (code: string) => `scrollstake:${code.toUpperCase()}:auth`;
export const policyKey = (code: string) => `scrollstake:${code.toUpperCase()}:policy`;

export function storeAuth(code: string, auth: SessionAuth) {
  sessionStorage.setItem(authKey(code), JSON.stringify(auth));
}

export function loadAuth(code: string): SessionAuth | null {
  try {
    const raw = sessionStorage.getItem(authKey(code));
    return raw ? JSON.parse(raw) as SessionAuth : null;
  } catch {
    return null;
  }
}

export function parseResources(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))].slice(0, 30);
}
