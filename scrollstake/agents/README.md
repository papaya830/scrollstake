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

## Giving this to your coding agent
`AGENTS.md` is picked up automatically by Codex and Cursor. `GEMINI.md` (Antigravity) and `CLAUDE.md` (Claude Code) just point to it. If your tool doesn't load any of them, attach `AGENTS.md`, `CONTEXT.md`, `INTERFACES.md`, and your brief from `agents/`, then paste the "Prompt to paste into your coding agent" block from your brief.

Tell your agent which role you are (A, B, C, or D) at the start of the session.
