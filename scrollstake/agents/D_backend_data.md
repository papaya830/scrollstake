# Agent brief: Dev D, API/backend glue, DB, pitch

**First read `CONTEXT.md` and `INTERFACES.md`.**

## Prompt to paste into your coding agent
> You are helping build ScrollStake, a hackathon project (16 hours). I own the backend glue in `web/app/api/`, `web/lib/`, and `web/db/`. Read CONTEXT.md and INTERFACES.md in the repo root. Starter code exists. Make the API match INTERFACES.md exactly, keep `SOLANA_DRY_RUN=1` working, wire real slashing through the Anchor IDL once Dev A delivers it, and add Postgres (Tiger Data) logging behind `DATABASE_URL`.

## You own
`web/app/api/**`, `web/lib/**`, `web/db/**`, `web/.env.example`, plus the pitch deck and demo recording.

## Tasks, in order
1. Run the API locally (see "Run it" below) and test with the curl commands. The whole CV -> API loop should work in dry-run mode within the first hour; Dev B and C are blocked on this.
2. Generate the oracle keypair with Dev A and put `ORACLE_SECRET_KEY` in `web/.env.local`.
3. When `web/idl/scrollstake.json` lands, set `SOLANA_DRY_RUN=0`, set `NEXT_PUBLIC_PROGRAM_ID`, and test a real slash on devnet. `lib/solana.ts` already has `slashOnChain`.
4. The in-memory store (`lib/store.ts`) is fine for the demo. If time allows, swap it for Postgres so sessions survive restarts.
5. Tiger Data (stretch): create a free instance, set `DATABASE_URL`, run `db/schema.sql`. `lib/db.ts` already inserts every event into `events`. Add a hypertable and a continuous aggregate (commented examples are in the schema), then expose `GET /api/leaderboard?code=...`.
6. Gemini Session Wrapped (stretch): at session end, send per-member stats to the Gemini API and return a short recap.
7. Pitch: 2-minute video of the loop: distraction -> slash -> UI updates. Lead with Solana (sub-cent fees, fast finality make micro-penalties possible).

## Run it
```bash
cd web
cp .env.example .env.local     # SOLANA_DRY_RUN=1 for now
npm run dev
```
```bash
# create a session
curl -s localhost:3000/api/sessions -H 'content-type: application/json' \
  -d '{"creatorWallet":"WALLET1","stakeUsdc":5,"penaltyUsdc":0.5,"lives":2}'
# join (use the returned code)
curl -s localhost:3000/api/sessions/join -H 'content-type: application/json' \
  -d '{"code":"AB12CD","wallet":"WALLET1","name":"Dave"}'
# send an event (use the returned clientToken)
curl -s localhost:3000/api/events -H 'content-type: application/json' -H 'x-client-token: TOKEN' \
  -d '{"code":"AB12CD","wallet":"WALLET1","type":"distraction","reason":"window:instagram","durationSec":12,"ts":1760000000}'
```
The first two distractions return `forgiven` (lives), then `slashed` with a `txSig`.

## Gotchas
- Next.js dev reloads wipe module state; `lib/store.ts` keeps its Map on `globalThis` to survive that.
- A slash can fail on-chain (stake already 0, RPC hiccup). The route returns `status: "error"` and does not consume a life.
- Do not log `ORACLE_SECRET_KEY` anywhere.

## Acceptance test
The three curl commands above work in dry-run mode, then again with `SOLANA_DRY_RUN=0` against the deployed devnet program.
