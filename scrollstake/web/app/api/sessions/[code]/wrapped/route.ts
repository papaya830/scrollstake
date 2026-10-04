import { NextResponse } from "next/server";
import { narrateWrapped } from "@/lib/gemini";
import { loadSnapshots, loadWrappedEvents, type WrappedSnapshot } from "@/lib/session-events";
import { getSession } from "@/lib/store";
import { buildBoard, buildWrapped } from "@/lib/wrapped";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession(code);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status !== "ended") return NextResponse.json({ error: "Wrapped opens when the session ends." }, { status: 409 });
  const wallet = new URL(req.url).searchParams.get("wallet") ?? session.creatorWallet;
  const [loaded, allSnapshots] = await Promise.all([loadWrappedEvents(session.code), loadSnapshots(session.code)]);
  const story = await narrateWrapped(buildWrapped(session, loaded.events, wallet));
  const perWallet = new Map<string, number>();
  const snapshots: WrappedSnapshot[] = allSnapshots.filter((shot) => {
    const seen = perWallet.get(shot.wallet) ?? 0;
    perWallet.set(shot.wallet, seen + 1);
    return seen < 3;
  });
  const board = buildBoard(session, loaded.events);
  const jarUsdc = board.reduce((sum, row) => sum + row.lostUsdc, 0);
  return NextResponse.json({ ...story, source: loaded.source, board, jarUsdc, snapshots });
}
