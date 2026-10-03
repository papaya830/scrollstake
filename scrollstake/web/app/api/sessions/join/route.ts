import { NextResponse } from "next/server";
import { joinSession } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b?.code || !b?.wallet) {
    return NextResponse.json({ error: "code and wallet required" }, { status: 400 });
  }
  const res = joinSession(String(b.code), String(b.wallet), String(b.name ?? "anon"));
  if (!res) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json(res);
}
