# Agent brief: Dev C, Frontend

**First read `CONTEXT.md` and `INTERFACES.md`.**

## Prompt to paste into your coding agent
> You are helping build ScrollStake, a hackathon project (16 hours). I own the frontend UI in `web/app/` (pages and components) and Privy auth. Read CONTEXT.md and INTERFACES.md in the repo root. The API routes in `web/app/api/` and `web/lib/` already exist and belong to Dev D; call them, do not rewrite them. Build: landing/auth page, create/join session by code, deposit-stake flow using the Anchor IDL in `web/idl/`, and a live session view that polls `GET /api/sessions/{code}` every 2s to show each member's lives, strikes, and slashed amount.

## You own
`web/app/**` pages and components (not `web/app/api/**`), `web/components/`, styling, Privy setup.

## Setup
The API boilerplate is in `web/`. Add the Next.js app around it:
```bash
cd web
npm install next@latest react react-dom typescript tailwindcss @privy-io/react-auth \
  @solana/web3.js @solana/spl-token @coral-xyz/anchor bs58 pg
npm install -D @types/node @types/react @types/pg
```
If `create-next-app` is easier, run it in a temp folder and copy `lib/`, `app/api/`, `db/`, `.env.example`, and `idl/` into the result. Keep the paths.

## Pages
1. `/` : sign in with Privy (embedded Solana wallet), choose Create or Join.
2. `/create` : form (stake, penalty, lives) -> `POST /api/sessions` -> redirect to `/s/{code}`.
3. `/join` : code + display name -> `POST /api/sessions/join`. Show the returned `clientToken` and the CV client env snippet (`SESSION_CODE`, `CLIENT_TOKEN`, `WALLET`) with a copy button. This is how Dev B's client gets configured.
4. `/s/[code]` : session view. Deposit button (see below), member cards (lives as hearts, strikes, slashed USDC), group pool total, withdraw button when the session ends.

## Deposit flow (on-chain)
Use the IDL in `web/idl/scrollstake.json` (Dev A delivers it). Derive the PDAs with the helpers in `web/lib/solana.ts` (`groupPda`, `stakePda`, `poolPda`). Call `program.methods.deposit(new BN(stakeUsdc * 1_000_000))` with accounts `{ member, group, stake, pool, memberAta, mint, tokenProgram, systemProgram }`. The first member to join a session also calls `create_group` (creator only). Until the contract is deployed, mock the deposit and keep building the UI.

## Gotchas
- Check the Privy docs for the current Solana embedded-wallet hooks; the API has changed between versions.
- USDC has 6 decimals; the UI shows decimals, the chain wants base units.
- Mobile-friendly layout is nice, but the demo will be on a laptop.
- Nice to have: a slash toast/animation when a member's strikes increase between polls.

## Acceptance test
Two browser windows: create a session in one, join in the other, both see each other's cards, and a slash from the API (curl it) shows up within 2 seconds.
