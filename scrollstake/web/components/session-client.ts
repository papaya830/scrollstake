export type Member = {
  wallet: string;
  name: string;
  livesLeft: number;
  strikes: number;
  slashedUsdc: number;
  lastEventAt: number;
};

export type SessionView = {
  code: string;
  creatorWallet: string;
  stakeUsdc: number;
  penaltyUsdc: number;
  lives: number;
  createdAt: number;
  members: Member[];
  monitoringPolicy?: { allowedResources: string[]; graceSeconds?: number; sampleIntervalSeconds?: number };
  endedAt?: number;
};

export type SessionAuth = { wallet: string; name: string; clientToken: string };

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
