import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";

export const USDC_DECIMALS = 6;
export const toBaseUnits = (usdc: number) => Math.round(usdc * 10 ** USDC_DECIMALS);

// ---- PDA helpers (also usable from the browser) ----
export const groupPda = (programId: PublicKey, groupId: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("group"), Buffer.from(groupId)], programId)[0];

export const poolPda = (programId: PublicKey, group: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("pool"), group.toBuffer()], programId)[0];

export const stakePda = (programId: PublicKey, group: PublicKey, member: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("stake"), group.toBuffer(), member.toBuffer()], programId)[0];

// ---- server-side oracle client ----
let cached: { program: Program<Idl>; oracle: Keypair } | null = null;

function getOracleProgram() {
  if (cached) return cached;
  const secret = process.env.ORACLE_SECRET_KEY;
  if (!secret) throw new Error("ORACLE_SECRET_KEY not set");
  const oracle = Keypair.fromSecretKey(bs58.decode(secret));
  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(oracle), { commitment: "confirmed" });

  // IDL is copied here by Dev A after `anchor build`. Read at runtime so the app builds without it.
  const idlPath = path.join(process.cwd(), "idl", "scrollstake.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl;
  cached = { program: new Program(idl, provider), oracle };
  return cached;
}

/** Slashes `amountBaseUnits` from `member` in group `groupId`. Returns the tx signature. */
export async function slashOnChain(groupId: string, memberWallet: string, amountBaseUnits: number): Promise<string> {
  if (process.env.SOLANA_DRY_RUN === "1") return `DRYRUN_${Date.now()}`;

  const { program, oracle } = getOracleProgram();
  const group = groupPda(program.programId, groupId);
  const stake = stakePda(program.programId, group, new PublicKey(memberWallet));

  return program.methods
    .slash(new BN(amountBaseUnits))
    .accounts({ oracle: oracle.publicKey, group, stake })
    .rpc();
}
