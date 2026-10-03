import { NextResponse } from "next/server";
import { authMember } from "@/lib/store";
import { slashOnChain, toBaseUnits } from "@/lib/solana";
import { logEvent } from "@/lib/db";
import type { EventBody, EventResponse } from "@/lib/types";

const MIN_GAP_MS = 5000; // ignore duplicate events fired back-to-back

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as EventBody | null;
  if (!body?.code || !body?.wallet || !body?.type) {
    return NextResponse.json({ status: "error", error: "bad request" } satisfies EventResponse, { status: 400 });
  }

  const auth = authMember(body.code, body.wallet, req.headers.get("x-client-token"));
  if (!auth) {
    return NextResponse.json({ status: "error", error: "unauthorized" } satisfies EventResponse, { status: 401 });
  }
  const { session, member } = auth;

  if (body.type !== "distraction") {
    return NextResponse.json({ status: "ignored", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }

  const now = Date.now();
  if (now - member.lastEventAt < MIN_GAP_MS) {
    return NextResponse.json({ status: "ignored", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }
  member.lastEventAt = now;

  const base = { code: session.code, wallet: member.wallet, name: member.name, reason: body.reason, durationSec: body.durationSec };

  // 1) Lives: forgive the first N distractions
  if (member.livesLeft > 0) {
    member.livesLeft -= 1;
    await logEvent({ ...base, status: "forgiven" });
    return NextResponse.json({ status: "forgiven", livesLeft: member.livesLeft, strikes: member.strikes } satisfies EventResponse);
  }

  // 2) Out of lives: slash on-chain via the oracle
  try {
    const txSig = await slashOnChain(session.code, member.wallet, toBaseUnits(session.penaltyUsdc));
    member.strikes += 1;
    member.slashedUsdc += session.penaltyUsdc;
    await logEvent({ ...base, status: "slashed", penaltyUsdc: session.penaltyUsdc, txSig });
    return NextResponse.json({ status: "slashed", livesLeft: 0, strikes: member.strikes, txSig } satisfies EventResponse);
  } catch (err) {
    console.error("[slash] failed", err);
    await logEvent({ ...base, status: "error" });
    return NextResponse.json({ status: "error", error: "slash failed" } satisfies EventResponse, { status: 502 });
  }
}
