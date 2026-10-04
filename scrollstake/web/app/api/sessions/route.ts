import { NextResponse } from "next/server";
import { createSession, PersistentStoreUnavailableError } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.creatorWallet !== "string") {
    return NextResponse.json({ error: "creatorWallet required" }, { status: 400 });
  }
  try {
    const session = await createSession({
      creatorWallet: b.creatorWallet,
      stakeUsdc: Number(b.stakeUsdc ?? 5),
      penaltyUsdc: Number(b.penaltyUsdc ?? 0.5),
      durationMinutes: Number(b.durationMinutes ?? 50),
      allowedResources: Array.isArray(b.allowedResources) ? b.allowedResources.filter((item: unknown) => typeof item === "string") : [],
      graceSeconds: Number(b.graceSeconds ?? 3),
    });
    return NextResponse.json({ code: session.code });
  } catch (error) {
    if (error instanceof PersistentStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
