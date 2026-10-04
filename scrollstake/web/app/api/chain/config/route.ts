import { NextResponse } from "next/server";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { DEFAULT_PROGRAM_ID } from "@/lib/solana";

/** Deliberately exposes public configuration only; the oracle secret never leaves the server. */
export async function GET() {
  const mint = process.env.NEXT_PUBLIC_USDC_MINT;
  const secret = process.env.ORACLE_SECRET_KEY;
  if (!mint || !secret || process.env.SOLANA_DRY_RUN !== "0") {
    const missing = [!mint && "NEXT_PUBLIC_USDC_MINT", !secret && "ORACLE_SECRET_KEY", process.env.SOLANA_DRY_RUN !== "0" && "SOLANA_DRY_RUN=0"].filter(Boolean);
    console.warn(`[chain] DRY-RUN: no devnet transactions will be sent. Missing: ${missing.join(", ")}`);
    return NextResponse.json({ error: "real-chain mode is not configured", missing }, { status: 503 });
  }
  try {
    return NextResponse.json({
      rpc: process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com",
      programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
      mint,
      oracle: Keypair.fromSecretKey(bs58.decode(secret)).publicKey.toBase58(),
    });
  } catch {
    return NextResponse.json({ error: "oracle configuration is invalid" }, { status: 503 });
  }
}
