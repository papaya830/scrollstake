import { NextResponse } from "next/server";
import { leaderboard } from "@/lib/db";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  return NextResponse.json(await leaderboard(code));
}
