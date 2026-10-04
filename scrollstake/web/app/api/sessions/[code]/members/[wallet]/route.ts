import { NextResponse } from "next/server";
import { markDeposit, updateMembership } from "@/lib/store";
import { toBaseUnits, verifyDepositOnChain } from "@/lib/solana";

export async function POST(req: Request, { params }: { params: Promise<{ code: string; wallet: string }> }) {
  const { code, wallet } = await params;
  const body = await req.json().catch(() => null) as { action?: string; actorWallet?: string; txSig?: string } | null;
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });
  if (body.action === "deposit") {
    try {
      const sessionBefore = await (await import("@/lib/store")).getSession(code);
      if (!sessionBefore) return NextResponse.json({ error: "session not found" }, { status: 404 });
      // Real-chain mode must never accept a fabricated receipt or a room created without an on-chain group.
      if (process.env.SOLANA_DRY_RUN === "0" && (String(body.txSig ?? "").startsWith("DRYRUN_") || !sessionBefore.groupTx)) {
        return NextResponse.json({ error: "This server is in real-chain mode but the deposit was a dry-run receipt. Create a new room so its group is created on devnet." }, { status: 409 });
      }
      await verifyDepositOnChain(code, wallet, toBaseUnits(sessionBefore.stakeUsdc), String(body.txSig ?? ""));
      const session = await markDeposit(code, wallet, String(body.txSig ?? ""));
      return session ? NextResponse.json(session) : NextResponse.json({ error: "deposit cannot be recorded" }, { status: 409 });
    } catch (error) {
      console.error("[chain] deposit verification failed", error);
      return NextResponse.json({ error: "deposit transaction could not be verified" }, { status: 422 });
    }
  }
  if (!["approve", "reject", "remove"].includes(body.action) || !body.actorWallet) return NextResponse.json({ error: "invalid membership action" }, { status: 400 });
  const session = await updateMembership(code, body.actorWallet, wallet, body.action as "approve" | "reject" | "remove");
  return session ? NextResponse.json(session) : NextResponse.json({ error: "membership action not allowed" }, { status: 403 });
}
