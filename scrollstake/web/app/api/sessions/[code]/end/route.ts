import { NextResponse } from "next/server";
import { endSession } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await req.json().catch(() => null) as { actorWallet?: string; reason?: string } | null;
  const session = body?.actorWallet ? await endSession(code, body.actorWallet, typeof body.reason === "string" ? body.reason : undefined) : undefined;
  return session ? NextResponse.json(session) : NextResponse.json({ error: "session cannot be ended" }, { status: 409 });
}
