import { NextResponse } from "next/server";
import { getSession, joinSession, PersistentStoreUnavailableError } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b?.code || !b?.wallet) {
    return NextResponse.json({ error: "code and wallet required" }, { status: 400 });
  }
  try {
    const res = await joinSession(String(b.code), String(b.wallet), String(b.name ?? "anon"));
    if (!res) {
      const existing = await getSession(String(b.code));
      if (!existing) return NextResponse.json({ error: "Session not found." }, { status: 404 });
      if (existing.status === "ended") return NextResponse.json({ error: "This room already ended.", status: "ended" }, { status: 409 });
      return NextResponse.json({ error: "This room already started.", status: existing.status }, { status: 409 });
    }
    return NextResponse.json(res);
  } catch (error) {
    if (error instanceof PersistentStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
