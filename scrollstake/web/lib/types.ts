export type Member = {
  wallet: string;
  name: string;
  livesLeft: number;
  strikes: number;
  slashedUsdc: number;
  lastEventAt: number;
};

export type Session = {
  code: string;
  creatorWallet: string;
  stakeUsdc: number;
  penaltyUsdc: number;
  lives: number;
  createdAt: number;
  members: Member[];
};

export type EventType = "distraction" | "heartbeat";

export type EventBody = {
  code: string;
  wallet: string;
  type: EventType;
  reason?: string;
  durationSec?: number;
  ts?: number;
};

export type EventResponse = {
  status: "forgiven" | "slashed" | "ignored" | "error";
  livesLeft?: number;
  strikes?: number;
  txSig?: string;
  error?: string;
};
