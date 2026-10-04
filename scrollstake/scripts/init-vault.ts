import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const MINT = new PublicKey(process.env.MINT!);
const HOUSE_TOKEN = new PublicKey(process.env.HOUSE_TOKEN!);
const SLASHER = new PublicKey(process.env.SLASHER!);

const STAKE_AMOUNT = new anchor.BN(5_000_000); // 5 tokens
const SLASH_AMOUNT = new anchor.BN(500_000);   // 0.50 tokens
const COOLDOWN_SECS = new anchor.BN(15);

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync("../target/idl/scrollstake.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
  const [vaultToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), vault.toBuffer()], program.programId);

  const sig = await program.methods
    .initializeVault(STAKE_AMOUNT, SLASH_AMOUNT, COOLDOWN_SECS, SLASHER)
    .accounts({
      admin: provider.wallet.publicKey,
      vault,
      mint: MINT,
      vaultToken,
      houseToken: HOUSE_TOKEN,
    })
    .rpc();

  console.log("initialized:", sig);
  console.log("vault PDA:", vault.toBase58());
  console.log("vault token:", vaultToken.toBase58());
})();
