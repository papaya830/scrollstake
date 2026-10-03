# Agent brief: Dev B, Computer Vision client

**First read `CONTEXT.md` and `INTERFACES.md`.**

## Prompt to paste into your coding agent
> You are helping build ScrollStake, a hackathon project (16 hours). I own the Python CV client in `cv-client/`. Read CONTEXT.md and INTERFACES.md in the repo root. Starter code is in `cv-client/`. The client must NEVER talk to Solana; it only POSTs distraction events to the API (`POST /api/events`). Improve detection accuracy and reliability, and keep `python main.py --dry-run --preview` working at all times.

## You own
Everything in `cv-client/`.

## How detection works (already stubbed)
1. `window_watch.py`: reads the active window title (browser tab titles show up in it) and matches it against category keyword lists (`DISTRACTING`) with an allow list (`ALLOW`) that wins ties.
2. `detector.py`: MediaPipe face mesh. Calibrates a baseline over the first ~3 seconds of looking at the screen, then flags "looking down" (head pitch or iris position deviating from baseline) and "face missing".
3. `main.py`: combines both signals. When distracted continuously for `GRACE_SECONDS`, it POSTs one `distraction` event, then waits `COOLDOWN_SECONDS` before it can fire again.

## Tasks, in order
1. `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
2. `cp .env.example .env`, then run `python main.py --dry-run --preview`. You should see the webcam with an overlay and console logs. Open Instagram or TikTok and confirm the window check trips.
3. Tune thresholds in `config.py` (`HEAD_DELTA`, `EYE_DELTA`, `GRACE_SECONDS`). Test with glasses, bad lighting, and different postures. Prefer false negatives over false positives (users have limited lives, but a false slash looks terrible in a demo).
4. Once D's API is up: set `CLIENT_TOKEN`, `SESSION_CODE`, `WALLET` in `.env` and run without `--dry-run`. Confirm the API responds `forgiven` / `slashed`.
5. Extend `DISTRACTING` / `ALLOW` with the team's site category list (the team agreed we need this list).
6. Stretch: grab a webcam still every 15-30 min and POST it to `/api/photos` (D defines this route) for the Session Wrapped.

## Gotchas
- macOS asks for camera and screen-recording/accessibility permissions the first time; window titles may come back empty until granted.
- Pin `mediapipe==0.10.14`. Newer releases changed the `solutions` API.
- Window titles contain the page title, not the URL. Match on keywords like `instagram`, `tiktok`, `reddit`, `youtube`.
- Keep a demo mode: `GRACE_SECONDS=10`. The real value in the plan is 60.

## Acceptance test
With the API running in `SOLANA_DRY_RUN=1`, opening a distracting site for 10 seconds causes the client to POST an event and print the response (`forgiven` or `slashed`).
