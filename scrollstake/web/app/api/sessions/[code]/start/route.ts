import { NextResponse } from "next/server";
import { startSession } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await req.json().catch(() => null) as { actorWallet?: string } | null;
  const session = body?.actorWallet ? await startSession(code, body.actorWallet) : undefined;
  return session ? NextResponse.json(session) : NextResponse.json({ error: "session cannot be started" }, { status: 409 });
}
