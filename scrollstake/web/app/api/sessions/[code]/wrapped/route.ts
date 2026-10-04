import { NextResponse } from "next/server";
import { narrateWrapped } from "@/lib/gemini";
import { loadWrappedEvents } from "@/lib/session-events";
import { getSession } from "@/lib/store";
import { buildWrapped } from "@/lib/wrapped";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession(code);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status !== "ended") return NextResponse.json({ error: "Wrapped opens when the session ends." }, { status: 409 });
  const wallet = new URL(req.url).searchParams.get("wallet") ?? session.creatorWallet;
  const loaded = await loadWrappedEvents(session.code);
  const story = await narrateWrapped(buildWrapped(session, loaded.events, wallet));
  return NextResponse.json({ ...story, source: loaded.source });
}
