import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo, createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { Scrollstake } from "../target/types/scrollstake";

const DEPOSIT = 20_000_000; // 20 USDC, 6 decimals
const SLASH = 500_000; // 0.50 USDC

describe("scrollstake", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Scrollstake as Program<Scrollstake>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const oracle = anchor.web3.Keypair.generate();
  const groupId = "demo01";

  let mint: anchor.web3.PublicKey;
  let memberAta: anchor.web3.PublicKey;
  let group: anchor.web3.PublicKey;
  let pool: anchor.web3.PublicKey;
  let stake: anchor.web3.PublicKey;

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    memberAta = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
    await mintTo(provider.connection, payer, mint, memberAta, payer.publicKey, 1_000_000_000);

    [group] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("group"), Buffer.from(groupId)],
      program.programId
    );
    [pool] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), group.toBuffer()],
      program.programId
    );
    [stake] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), group.toBuffer(), payer.publicKey.toBuffer()],
      program.programId
    );
  });

  it("creates a group, deposits, and slashes only for the oracle", async () => {
    await program.methods
      .createGroup(groupId)
      .accounts({
        authority: payer.publicKey,
        oracle: oracle.publicKey,
        mint,
        group,
        pool,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .deposit(new anchor.BN(DEPOSIT))
      .accounts({
        member: payer.publicKey,
        group,
        stake,
        pool,
        memberAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    let stakeAccount = await program.account.stake.fetch(stake);
    assert.equal(stakeAccount.amount.toNumber(), DEPOSIT);

    try {
      await program.methods
        .slash(new anchor.BN(SLASH))
        .accounts({
          oracle: payer.publicKey,
          group,
          stake,
        })
        .rpc();
      assert.fail("a normal user must not be able to slash");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.include(message, "NotOracle");
    }

    await program.methods
      .slash(new anchor.BN(SLASH))
      .accounts({
        oracle: oracle.publicKey,
        group,
        stake,
      })
      .signers([oracle])
      .rpc();

    stakeAccount = await program.account.stake.fetch(stake);
    const groupAccount = await program.account.group.fetch(group);
    assert.equal(stakeAccount.amount.toNumber(), DEPOSIT - SLASH);
    assert.equal(stakeAccount.slashed.toNumber(), SLASH);
    assert.equal(stakeAccount.strikes, 1);
    assert.equal(groupAccount.penaltyTotal.toNumber(), SLASH);

    const poolAfterSlash = await getAccount(provider.connection, pool);
    assert.equal(Number(poolAfterSlash.amount), DEPOSIT);
  });

  it("lets the member withdraw what is left", async () => {
    await program.methods
      .withdraw()
      .accounts({
        member: payer.publicKey,
        group,
        stake,
        pool,
        memberAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const stakeAccount = await program.account.stake.fetch(stake);
    const member = await getAccount(provider.connection, memberAta);
    const poolAccount = await getAccount(provider.connection, pool);

    assert.equal(stakeAccount.amount.toNumber(), 0);
    assert.equal(Number(member.amount), 1_000_000_000 - SLASH);
    assert.equal(Number(poolAccount.amount), SLASH);
  });
});
