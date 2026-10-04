import { NextResponse } from "next/server";
import { focusPulse } from "@/lib/db";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  try {
    return NextResponse.json(await focusPulse(code));
  } catch (error) {
    console.error("[analytics] query failed", error);
    return NextResponse.json({ error: "Tiger analytics are unavailable" }, { status: 503 });
  }
}
