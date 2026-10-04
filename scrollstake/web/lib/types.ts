export type MembershipStatus = "pending" | "approved" | "rejected" | "removed";
export type SessionStatus = "lobby" | "live" | "ended";

export type Member = {
  wallet: string;
  name: string;
  livesLeft: number;
  strikes: number;
  slashedUsdc: number;
  lastEventAt: number;
  membershipStatus: MembershipStatus;
  depositedAt?: number;
  depositTx?: string;
};

export type MonitoringPolicy = {
  allowedResources: string[];
  graceSeconds: number;
  sampleIntervalSeconds: number;
};

export type Session = {
  code: string;
  creatorWallet: string;
  stakeUsdc: number;
  penaltyUsdc: number;
  lives: number;
  createdAt: number;
  members: Member[];
  status: SessionStatus;
  durationMinutes: number;
  startsAt?: number;
  endsAt?: number;
  endedAt?: number;
  endReason?: string;
  chainReady?: boolean;
  groupTx?: string;
  monitoringPolicy: MonitoringPolicy;
};

export type EventType = "distraction" | "heartbeat";
export type EventBody = { code: string; wallet: string; type: EventType; source?: string; reason?: string; durationSec?: number; ts?: number; snapshot?: { camera?: string; screen?: string } };
export type EventResponse = { status: "forgiven" | "slashed" | "ignored" | "error"; livesLeft?: number; strikes?: number; txSig?: string; error?: string };
