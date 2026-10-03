# ScrollStake: Shared Context (paste/attach this to EVERY agent)

## One-liner
Study groups put USDC on the line. A local computer-vision client watches for doomscrolling / distraction. If you stay distracted past a grace period and are out of "lives", a Solana smart contract slashes a small amount of your stake into the group's shared pool (the "hang-out fund"). At the end we show a Spotify-Wrapped-style session recap.

Hackathon: 16 hours of build time. Primary prize track: **Best Use of Solana** (locked). Stretch tracks: ElevenLabs (narration), Gemini API (Session Wrapped), Tiger Data (Postgres + real-time analytics, our DB). Snowflake: skipped.

## Priorities
**MVP (must work end to end, in this order)**
1. Distraction detection (OpenCV/MediaPipe webcam + active-window/site check).
2. Solana contract: shared group pool, deposit, slash, withdraw.
3. Backend glue: CV client -> API -> on-chain slash.
4. Web app: sessions (join by code), deposit stake, live session view with strikes/lives.

**Nice to have, only after MVP works**: Session Wrapped (Gemini), periodic photos (every 15-30 min), ElevenLabs narration, Tiger Data leaderboard, Discord bot.

## Decisions already made (do not relitigate; flag to the team if blocked)
- **Detection signal**: primary = active window / browser tab title matched against a distracting-site category list. Secondary = webcam "looking down at phone" heuristic via MediaPipe face mesh. Phone object detection is out of scope.
- **Who signs the slash**: a backend "oracle" keypair, NOT the user's wallet. CV client never touches Solana. It POSTs events to our API; the API applies "lives" logic and calls the contract. (A user-signed slash would let users just not sign.)
- **Vault model**: one SPL-token pool account per study group (PDA). Each member has a per-group `Stake` account tracking their remaining balance. Slashed funds stay in the pool (= hang-out fund). Members withdraw their remaining stake at session end.
- **Lives**: first N distractions per member per session are forgiven (computer error / false positives). Tracked off-chain in the API.
- **Admin**: the group creator is `authority`; the backend is `oracle`. No other admin logic.
- **Discord bot**: dropped from MVP. If we do ElevenLabs, audio plays in the web app session view.
- **Demo values**: stake 5-20 USDC (devnet test mint), penalty 0.50 USDC, grace period 10s for the demo (60s in the real config).
- **USDC has 6 decimals**: 0.50 USDC = `500_000` base units. Always pass base units on-chain, decimals only in UI.

## Architecture
```
 [Webcam + active window]
   cv-client (Python)
        | POST /api/events  (x-client-token)
        v
 web/ Next.js (App Router)  <---- browser UI (Privy auth, deposits via Anchor IDL)
   app/api/*  (lives logic, session store, event log)
        | slash() signed by ORACLE keypair
        v
 Solana devnet: programs/scrollstake (Anchor)
        |
        +--> Postgres (Tiger Data) via DATABASE_URL  [optional until stretch phase]
```

## Repo layout
```
scrollstake/
  CONTEXT.md            <- this file
  INTERFACES.md         <- the contracts between components (source of truth)
  agents/               <- one brief per teammate
  programs/scrollstake/ <- Anchor program (Rust)
  cv-client/            <- Python OpenCV client
  web/                  <- Next.js app + API routes (lib/, app/api/, db/)
```

## Team and ownership (only edit your own area; ask before changing INTERFACES.md)
| Dev | Area | Brief |
|---|---|---|
| A | Solana contract + deploy + (stretch) ElevenLabs | agents/A_solana.md |
| B | CV client | agents/B_cv.md |
| C | Frontend (Next.js UI + Privy + deposits) | agents/C_frontend.md |
| D | API/backend glue, DB, pitch/demo | agents/D_backend_data.md |

## Working agreements
- Branch per person, small commits, rebase often. Merge to `main` only when your acceptance test passes.
- `INTERFACES.md` is the source of truth. If you need to change a shape, change it there first and tell the group chat.
- Use `SOLANA_DRY_RUN=1` in the API to develop the CV client and UI before the contract is deployed.
- Never commit keypairs or `.env`. The oracle secret goes in `.env.local` only.
- Prefer working and ugly over elegant and unfinished. Code freeze 3 hours before the demo recording.

## Milestones
1. **Hour 0-3**: everyone scaffolds; CV client POSTs a fake event to the API in dry-run mode.
2. **Hour 3-8**: contract deployed to devnet; API slashes for real; UI can deposit.
3. **Hour 8-12**: full loop on a real distraction: detect -> API -> slash -> UI updates.
4. **Hour 12-14**: stretch features, one at a time (Wrapped, ElevenLabs, Tiger Data).
5. **Hour 14-16**: freeze, rehearse, record demo.
