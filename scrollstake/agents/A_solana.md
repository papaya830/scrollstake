# Agent brief: Dev A, Solana contract (+ stretch: ElevenLabs)

**First read `CONTEXT.md` and `INTERFACES.md`.**

## Prompt to paste into your coding agent
> You are helping build ScrollStake, a hackathon project (16 hours). I own the Solana Anchor program in `programs/scrollstake/`. Read CONTEXT.md and INTERFACES.md in the repo root. Starter code is in `programs/scrollstake/src/lib.rs`. Make it compile, deploy to devnet, and write a TS test that creates a group, deposits, slashes via the oracle, and withdraws. Do not change instruction names, account seeds, or arg types without telling me, because other teammates depend on the IDL.

## You own
`programs/`, `Anchor.toml`, `Cargo.toml`, `tests/`, `scripts/`, and the generated IDL.

## Tasks, in order
1. `anchor init`-style setup is already scaffolded. Run `anchor build`, then `anchor keys sync` (updates the program id in `lib.rs` and `Anchor.toml`), then `anchor build` again.
2. Create a test SPL mint on devnet (6 decimals) with `spl-token create-token --decimals 6`, mint yourself and teammates some tokens. Post the mint address in the group chat; it becomes `NEXT_PUBLIC_USDC_MINT`.
3. Create the oracle keypair (`solana-keygen new -o oracle.json`), airdrop devnet SOL, and give D the base58 secret (privately).
4. Write `tests/scrollstake.ts`: create_group -> deposit -> slash -> check balances -> withdraw.
5. `anchor deploy --provider.cluster devnet`. Post the program id.
6. Copy `target/idl/scrollstake.json` to `web/idl/scrollstake.json` and `target/types/scrollstake.ts` to `web/idl/scrollstake.ts`. Tell C and D.
7. Stretch (only after the full loop works): ElevenLabs. Add a route `web/app/api/narrate/route.ts` that takes `{ text }` and returns an MP3 from the ElevenLabs TTS REST API. Trigger it from the session UI when a `slashed` status arrives.

## Gotchas
- `group_id` is used as a PDA seed, so keep it <= 16 bytes.
- Devnet airdrops are rate-limited; use https://faucet.solana.com if the CLI fails.
- The oracle pays transaction fees, so keep it funded with SOL.
- Slash amounts are in base units (6 decimals): 0.50 USDC = 500000.
- `init_if_needed` is enabled in Cargo.toml for the `Stake` account in `deposit`.

## Acceptance test
`anchor test` (or your TS test against devnet) passes, and `web/idl/scrollstake.json` exists.
