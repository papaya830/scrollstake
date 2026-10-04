# ScrollStake

Study groups stake USDC on Solana. A local CV client catches doomscrolling; the backend slashes the stake into the group's hang-out fund.

**Start here:** read `CONTEXT.md`, then `INTERFACES.md`, then your brief in `agents/`.

```
programs/scrollstake/  Anchor program (Dev A)
cv-client/             Python OpenCV client (Dev B)
web/                   Next.js UI (Dev C) + API routes, lib, db (Dev D)
agents/                one brief + paste-in prompt per teammate
```

## Quick start for each role
- **A:** `anchor build && anchor keys sync && anchor build`, then deploy to devnet.
- **B:** `cd cv-client && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cp .env.example .env && python main.py --dry-run --preview`
- **C/D:** `cd web && npm install && cp .env.example .env.local && npm run dev`

## Free preview

`/preview` lets anyone feel a slash before staking: webcam or a "Simulate getting caught" button, a simulated 20.00 → 19.50 balance, and a spoken roast. It is entirely client-side (no session, wallet, chain, DB or `/api/*` calls).

## Vercel shared-session setup

Shared rooms cannot use browser storage or Vercel function memory. Create a Postgres database, run `web/db/schema.sql` against it, then add its connection string as `DATABASE_URL` (or `TIMESCALE_SERVICE_URL`) in the Vercel project's Production environment and redeploy. The app deliberately returns a clear setup error instead of creating a non-shareable room when that variable is absent.

After deployment, create a room and send the creator's **Copy invite link** URL (`/s/<CODE>`) to the other participant. Each participant uses their own browser storage for their display name, wallet, and monitoring token; the room itself is in Postgres.

## Giving this to your coding agent (Cursor etc.)
Attach `CONTEXT.md`, `INTERFACES.md`, and your brief from `agents/`, then paste the "Prompt to paste into your coding agent" block from your brief.
