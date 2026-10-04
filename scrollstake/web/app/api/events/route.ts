import { NextResponse } from "next/server";
import { authMember, recordForgiven, recordSlash } from "@/lib/store";
import { slashOnChain, toBaseUnits } from "@/lib/solana";
import { logEvent } from "@/lib/db";
import type { EventBody, EventResponse } from "@/lib/types";

const MIN_GAP_MS = 5000; // ignore duplicate events fired back-to-back

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as EventBody | null;
  if (!body?.code || !body?.wallet || !body?.type) {
    return NextResponse.json({ status: "error", error: "bad request" } satisfies EventResponse, { status: 400 });
  }

  const auth = await authMember(body.code, body.wallet, req.headers.get("x-client-token"));
  if (!auth) {
    return NextResponse.json({ status: "error", error: "unauthorized" } satisfies EventResponse, { status: 401 });
  }
  const { session, member } = auth;

  if (session.status !== "live") {
    return NextResponse.json({ status: "ignored", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }

  const source = typeof body.source === "string" ? body.source.slice(0, 40) : "unknown";
  const base = { code: session.code, wallet: member.wallet, name: member.name, source, reason: body.reason, durationSec: body.durationSec };
  if (body.type === "heartbeat") {
    await logEvent({ ...base, status: "heartbeat", eventKind: "heartbeat" });
    return NextResponse.json({ status: "ignored", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }

  const now = Date.now();
  if (now - member.lastEventAt < MIN_GAP_MS) {
    return NextResponse.json({ status: "ignored", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }
  // 1) Lives: forgive the first N distractions
  if (member.livesLeft > 0) {
    const updated = await recordForgiven(session.code, member.wallet, now);
    await logEvent({ ...base, status: "forgiven", eventKind: "distraction" });
    return NextResponse.json({ status: "forgiven", livesLeft: updated?.livesLeft ?? member.livesLeft - 1, strikes: updated?.strikes ?? member.strikes } satisfies EventResponse);
  }

  // 2) Out of lives: slash on-chain via the oracle
  try {
    const txSig = await slashOnChain(session.code, member.wallet, toBaseUnits(session.penaltyUsdc));
    const updated = await recordSlash(session.code, member.wallet, now, session.penaltyUsdc);
    await logEvent({ ...base, status: "slashed", eventKind: "distraction", penaltyUsdc: session.penaltyUsdc, txSig });
    return NextResponse.json({ status: "slashed", livesLeft: updated?.livesLeft ?? 0, strikes: updated?.strikes ?? member.strikes + 1, txSig } satisfies EventResponse);
  } catch (err) {
    console.error("[slash] failed", err);
    await logEvent({ ...base, status: "error", eventKind: "distraction" });
    return NextResponse.json({ status: "error", error: "slash failed" } satisfies EventResponse, { status: 502 });
  }
}
