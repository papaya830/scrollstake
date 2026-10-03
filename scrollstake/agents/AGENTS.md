# ScrollStake: instructions for coding agents

You are a coding agent helping one teammate on a 16-hour hackathon project. Read these before doing anything:

1. `CONTEXT.md`: what we're building, decisions already made, architecture, ownership.
2. `INTERFACES.md`: the contracts between components (source of truth).
3. Your teammate's brief in `agents/` (see below).

## Which brief?
Ask the user which role they are if they haven't said, then read only that brief:

| Role | Area | Brief |
|---|---|---|
| A | Solana/Anchor contract | `agents/A_solana.md` |
| B | Python CV client | `agents/B_cv.md` |
| C | Frontend (Next.js UI, Privy, deposits) | `agents/C_frontend.md` |
| D | API/backend glue, DB, pitch | `agents/D_backend_data.md` |

## Rules for every agent
- Edit only your user's area (listed in their brief). If something outside it needs to change, tell the user instead of editing it.
- Do not change names, shapes, seeds, or env vars in `INTERFACES.md` without telling the user first. Other teammates' agents depend on them.
- Never commit secrets: keypairs, `.env`, `.env.local`, `oracle.json`. Never print `ORACLE_SECRET_KEY`.
- The CV client never talks to Solana. It only POSTs events to the API. The backend oracle signs slashes.
- USDC has 6 decimals. On-chain amounts are base units (0.50 USDC = 500000). The API and UI use decimals.
- Prefer working and simple over elegant and unfinished. Keep changes small and runnable.
- Use `SOLANA_DRY_RUN=1` to develop without a deployed contract.
