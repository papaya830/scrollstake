"""ScrollStake CV client.

Detects distraction (active window + webcam) and POSTs events to the API.
It never talks to Solana. The API decides forgiven vs slashed.

    python main.py --dry-run --preview    # no network, show webcam overlay
    python main.py                        # send events to API_URL
"""
import argparse
import time

import cv2
import requests

import config
from detector import LookDownDetector
from window_watch import check_window


def send_event(reason: str, duration: float) -> None:
    body = {
        "code": config.SESSION_CODE,
        "wallet": config.WALLET,
        "type": "distraction",
        "reason": reason,
        "durationSec": round(duration, 1),
        "ts": int(time.time()),
    }
    try:
        r = requests.post(
            f"{config.API_URL}/api/events",
            json=body,
            headers={"x-client-token": config.CLIENT_TOKEN},
            timeout=10,
        )
        print(f"[event] {reason} -> {r.status_code} {r.text}")
    except requests.RequestException as e:
        print(f"[event] failed to reach API: {e}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print events instead of sending")
    ap.add_argument("--preview", action="store_true", help="show webcam window with overlay")
    ap.add_argument("--no-cam", action="store_true", help="window check only (no webcam)")
    args = ap.parse_args()

    cap = None if args.no_cam else cv2.VideoCapture(config.CAMERA_INDEX)
    if cap is not None and not cap.isOpened():
        raise SystemExit("Could not open webcam. Check permissions or CAMERA_INDEX in config.py")
    det = None if args.no_cam else LookDownDetector()

    print(f"Calibrating for {config.CALIBRATION_SECONDS}s: look at your screen normally...")
    distracted_since = None
    cooldown_until = 0.0

    try:
        while True:
            reason = None
            status = "focused"

            if cap is not None:
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.1)
                    continue
                reading = det.read(frame)
                if not det.calibrate(reading):
                    status = "calibrating"
                else:
                    reason = det.reason(reading)
            else:
                frame = None

            # Window check is the primary signal and always runs.
            reason = check_window() or reason

            now = time.time()
            if reason and now >= cooldown_until and status != "calibrating":
                if distracted_since is None:
                    distracted_since = now
                elapsed = now - distracted_since
                status = f"distracted {elapsed:0.0f}/{config.GRACE_SECONDS:0.0f}s ({reason})"
                if elapsed >= config.GRACE_SECONDS:
                    if args.dry_run:
                        print(f"[dry-run] would send distraction: {reason} ({elapsed:0.1f}s)")
                    else:
                        send_event(reason, elapsed)
                    cooldown_until = now + config.COOLDOWN_SECONDS
                    distracted_since = None
            elif not reason:
                distracted_since = None

            if args.preview and frame is not None:
                color = (0, 0, 255) if status.startswith("distracted") else (0, 200, 0)
                cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                cv2.imshow("ScrollStake", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            else:
                time.sleep(config.LOOP_SLEEP)
    except KeyboardInterrupt:
        pass
    finally:
        if cap is not None:
            cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
