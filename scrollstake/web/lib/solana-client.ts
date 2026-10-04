"use client";

import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "@/idl/scrollstake.json";
const groupPda = (programId: PublicKey, groupId: string) => PublicKey.findProgramAddressSync([Buffer.from("group"), Buffer.from(groupId)], programId)[0];
const poolPda = (programId: PublicKey, group: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("pool"), group.toBuffer()], programId)[0];
const stakePda = (programId: PublicKey, group: PublicKey, member: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("stake"), group.toBuffer(), member.toBuffer()], programId)[0];
const toBaseUnits = (usdc: number) => Math.round(usdc * 1_000_000);

type InjectedWallet = {
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
};

declare global { interface Window { solana?: InjectedWallet } }

type ChainConfig = { rpc: string; programId: string; mint: string; oracle: string };

async function config(): Promise<ChainConfig> {
  const response = await fetch("/api/chain/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Real devnet transactions are not configured on this deployment.");
  return response.json() as Promise<ChainConfig>;
}

async function program() {
  const injected = window.solana;
  if (!injected) throw new Error("Install or unlock a Phantom-compatible Solana wallet to continue.");
  const connected = await injected.connect();
  const chain = await config();
  const wallet: Wallet = {
    publicKey: connected.publicKey,
    signTransaction: injected.signTransaction.bind(injected),
    signAllTransactions: injected.signAllTransactions?.bind(injected) ?? (async (items) => Promise.all(items.map((item) => injected.signTransaction(item)))),
  };
  const provider = new AnchorProvider(new Connection(chain.rpc, "confirmed"), wallet, { commitment: "confirmed" });
  return { chain, wallet: connected.publicKey, program: new Program(idl as Idl, provider) };
}

export async function connectedWallet(): Promise<string> {
  const injected = window.solana;
  if (!injected) throw new Error("Install or unlock a Phantom-compatible Solana wallet to continue.");
  return (await injected.connect()).publicKey.toBase58();
}

export async function createGroupOnChain(code: string): Promise<{ wallet: string; txSig: string }> {
  const { chain, wallet, program: anchorProgram } = await program();
  const programId = new PublicKey(chain.programId);
  const group = groupPda(programId, code);
  const txSig = await anchorProgram.methods.createGroup(code).accounts({
    authority: wallet, oracle: new PublicKey(chain.oracle), mint: new PublicKey(chain.mint), group, pool: poolPda(programId, group),
  }).rpc();
  return { wallet: wallet.toBase58(), txSig };
}

export async function depositOnChain(code: string, stakeUsdc: number): Promise<{ wallet: string; txSig: string }> {
  const { chain, wallet, program: anchorProgram } = await program();
  const programId = new PublicKey(chain.programId);
  const group = groupPda(programId, code);
  const txSig = await anchorProgram.methods.deposit(new BN(toBaseUnits(stakeUsdc))).accounts({
    member: wallet, group, stake: stakePda(programId, group, wallet), pool: poolPda(programId, group),
    memberAta: getAssociatedTokenAddressSync(new PublicKey(chain.mint), wallet),
  }).rpc();
  return { wallet: wallet.toBase58(), txSig };
}

export async function withdrawOnChain(code: string): Promise<string> {
  const { chain, wallet, program: anchorProgram } = await program();
  const programId = new PublicKey(chain.programId);
  const group = groupPda(programId, code);
  return anchorProgram.methods.withdraw().accounts({
    member: wallet, group, stake: stakePda(programId, group, wallet), pool: poolPda(programId, group),
    memberAta: getAssociatedTokenAddressSync(new PublicKey(chain.mint), wallet),
  }).rpc();
}
