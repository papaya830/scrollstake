import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";

export const USDC_DECIMALS = 6;
export const DEFAULT_PROGRAM_ID = "7mDauA2UnGfJsy7TPQLRJT5wc5HbExaXMoicnxM2Dk96";
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
  const wallet: Wallet = {
    publicKey: oracle.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      if (transaction instanceof Transaction) transaction.partialSign(oracle);
      else transaction.sign([oracle]);
      return transaction;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
      return Promise.all(transactions.map((transaction) => this.signTransaction(transaction)));
    },
  };
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // IDL is copied here by Dev A after `anchor build`. Read at runtime so the app builds without it.
  const idlPath = path.join(process.cwd(), "idl", "scrollstake.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl;
  cached = { program: new Program(idl, provider), oracle };
  return cached;
}

function getChainConfig() {
  const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID ?? DEFAULT_PROGRAM_ID);
  const mint = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!mint) throw new Error("NEXT_PUBLIC_USDC_MINT not set");
  const secret = process.env.ORACLE_SECRET_KEY;
  if (!secret) throw new Error("ORACLE_SECRET_KEY not set");
  return { programId, mint: new PublicKey(mint), oracle: Keypair.fromSecretKey(bs58.decode(secret)).publicKey };
}

/** Confirms the client-created group exists, is owned by this program, and binds this room to its creator and oracle. */
export async function verifyGroupCreation(groupId: string, creatorWallet: string, txSig: string): Promise<void> {
  if (process.env.SOLANA_DRY_RUN !== "0") return;
  const { programId, mint, oracle } = getChainConfig();
  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const status = await connection.getSignatureStatus(txSig, { searchTransactionHistory: true });
  if (status.value?.err || !status.value?.confirmationStatus) throw new Error("group transaction is not confirmed");
  const group = groupPda(programId, groupId);
  const info = await connection.getAccountInfo(group, "confirmed");
  if (!info || !info.owner.equals(programId)) throw new Error("group account is missing or owned by another program");
  const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "idl", "scrollstake.json"), "utf8")) as Idl;
  const decoded = new Program(idl, { connection } as AnchorProvider).coder.accounts.decode("group", info.data) as unknown as { authority: PublicKey; oracle: PublicKey; mint: PublicKey; groupId: string };
  if (!decoded.authority.equals(new PublicKey(creatorWallet)) || !decoded.oracle.equals(oracle) || !decoded.mint.equals(mint) || decoded.groupId !== groupId) throw new Error("group account does not match this session");
}

/** Confirms the member's on-chain stake has at least the room stake before recording it off-chain. */
export async function verifyDepositOnChain(groupId: string, memberWallet: string, amountBaseUnits: number, txSig: string): Promise<void> {
  if (process.env.SOLANA_DRY_RUN !== "0") return;
  const { programId } = getChainConfig();
  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const status = await connection.getSignatureStatus(txSig, { searchTransactionHistory: true });
  if (status.value?.err || !status.value?.confirmationStatus) throw new Error("deposit transaction is not confirmed");
  const group = groupPda(programId, groupId);
  const stake = stakePda(programId, group, new PublicKey(memberWallet));
  const info = await connection.getAccountInfo(stake, "confirmed");
  if (!info || !info.owner.equals(programId)) throw new Error("stake account is missing");
  const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "idl", "scrollstake.json"), "utf8")) as Idl;
  const decoded = new Program(idl, { connection } as AnchorProvider).coder.accounts.decode("stake", info.data) as unknown as { member: PublicKey; group: PublicKey; amount: BN };
  if (!decoded.member.equals(new PublicKey(memberWallet)) || !decoded.group.equals(group) || decoded.amount.lt(new BN(amountBaseUnits))) throw new Error("stake account does not cover this room's stake");
}

/** Slashes `amountBaseUnits` from `member` in group `groupId`. Returns the tx signature. */
export async function slashOnChain(groupId: string, memberWallet: string, amountBaseUnits: number): Promise<string> {
  if (process.env.SOLANA_DRY_RUN !== "0") return `DRYRUN_${Date.now()}`;

  const { program, oracle } = getOracleProgram();
  const group = groupPda(program.programId, groupId);
  const stake = stakePda(program.programId, group, new PublicKey(memberWallet));

  return program.methods
    .slash(new BN(amountBaseUnits))
    .accounts({ oracle: oracle.publicKey, group, stake })
    .rpc();
}
