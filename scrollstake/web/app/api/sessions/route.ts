import { NextResponse } from "next/server";
import { createSession } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.creatorWallet !== "string") {
    return NextResponse.json({ error: "creatorWallet required" }, { status: 400 });
  }
  const session = await createSession({
    creatorWallet: b.creatorWallet,
    stakeUsdc: Number(b.stakeUsdc ?? 5),
    penaltyUsdc: Number(b.penaltyUsdc ?? 0.5),
    lives: Number(b.lives ?? 2),
    durationMinutes: Number(b.durationMinutes ?? 50),
    allowedResources: Array.isArray(b.allowedResources) ? b.allowedResources.filter((item: unknown) => typeof item === "string") : [],
  });
  return NextResponse.json({ code: session.code });
}
