import { NextResponse } from "next/server";
import { markChainReady } from "@/lib/store";
import { verifyGroupCreation } from "@/lib/solana";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await req.json().catch(() => null) as { actorWallet?: string; txSig?: string } | null;
  if (!body?.actorWallet || !body.txSig) return NextResponse.json({ error: "actorWallet and txSig required" }, { status: 400 });
  try {
    await verifyGroupCreation(code, body.actorWallet, body.txSig);
    const session = await markChainReady(code, body.actorWallet, body.txSig);
    return session ? NextResponse.json(session) : NextResponse.json({ error: "group cannot be recorded" }, { status: 409 });
  } catch (error) {
    console.error("[chain] group verification failed", error);
    return NextResponse.json({ error: "group transaction could not be verified" }, { status: 422 });
  }
}
