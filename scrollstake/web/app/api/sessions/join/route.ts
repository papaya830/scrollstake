import { NextResponse } from "next/server";
import { joinSession, PersistentStoreUnavailableError } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b?.code || !b?.wallet) {
    return NextResponse.json({ error: "code and wallet required" }, { status: 400 });
  }
  try {
    const res = await joinSession(String(b.code), String(b.wallet), String(b.name ?? "anon"));
    if (!res) return NextResponse.json({ error: "session not found" }, { status: 404 });
    return NextResponse.json(res);
  } catch (error) {
    if (error instanceof PersistentStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
