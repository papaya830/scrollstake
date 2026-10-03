"""ScrollStake CV client.

Detects distraction (active window + webcam) and POSTs events to the API.
It never talks to Solana. The API decides forgiven vs slashed.

    python main.py --dry-run --preview    # no network, show webcam overlay
    python main.py                        # send events to API_URL
    python main.py --no-cam --dry-run     # window check only (no webcam)

Preview keys: q = quit, c = recalibrate (look at your screen, sit normally).
"""
import argparse
import sys
import time

import cv2
import requests

import config
from trigger import Debounce, DistractionTimer
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


def open_camera(index: int):
    """DirectShow opens much faster than the default MSMF backend on Windows."""
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if cap.isOpened():
            return cap
        cap.release()
    return cv2.VideoCapture(index)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print events instead of sending")
    ap.add_argument("--preview", action="store_true", help="show webcam window with overlay")
    ap.add_argument("--no-cam", action="store_true", help="window check only (no webcam)")
    ap.add_argument("--debug", action="store_true", help="print head/eye deltas about once a second")
    args = ap.parse_args()

    if not args.dry_run and not (config.SESSION_CODE and config.CLIENT_TOKEN and config.WALLET):
        raise SystemExit("Set SESSION_CODE, CLIENT_TOKEN and WALLET in .env (or use --dry-run).")

    cap = None if args.no_cam else open_camera(config.CAMERA_INDEX)
    if cap is not None and not cap.isOpened():
        raise SystemExit("Could not open webcam. Check permissions or CAMERA_INDEX in .env")
    if args.no_cam and args.preview:
        print("note: --preview needs the webcam; ignoring it with --no-cam")
    det = None
    if cap is not None:
        from detector import LookDownDetector  # import lazily so --no-cam works without mediapipe
        det = LookDownDetector()
        print(f"Calibrating for {config.CALIBRATION_SECONDS}s: look at your screen normally...")

    window_db = Debounce(on_after=0.0, off_after=config.WINDOW_OFF_AFTER)
    cam_db = Debounce(on_after=config.CAM_ON_AFTER, off_after=config.CAM_OFF_AFTER)
    timer = DistractionTimer(config.GRACE_SECONDS, config.COOLDOWN_SECONDS)

    window_reason = None
    next_window_poll = 0.0
    next_debug = 0.0
    was_calibrated = False

    try:
        while True:
            now = time.time()
            frame, cam_reason, calibrating = None, None, False

            if cap is not None:
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.1)
                    continue
                reading = det.read(frame)
                if det.calibrate(reading):
                    if not was_calibrated:
                        print("Calibrated. Monitoring.")
                        was_calibrated = True
                    cam_reason = det.reason(reading)
                else:
                    calibrating = True

            # Window check is the primary signal. It runs even while the camera calibrates
            # (and even if the camera never sees a face).
            if now >= next_window_poll:
                window_reason = check_window()
                next_window_poll = now + config.WINDOW_POLL_SECONDS

            # Update both debouncers every frame (don't short-circuit, or one goes stale).
            w_active = window_db.update(now, window_reason)
            c_active = cam_db.update(now, cam_reason)
            reason = w_active or c_active
            fired, status = timer.update(now, reason)
            if calibrating and not reason:
                status = "calibrating"

            if fired:
                reason_s, elapsed = fired
                if args.dry_run:
                    print(f"[dry-run] would send distraction: {reason_s} ({elapsed:0.1f}s)")
                else:
                    send_event(reason_s, elapsed)

            if args.debug and det is not None and now >= next_debug:
                dh, de = det.last_deltas
                fmt = lambda v: "  n/a " if v is None else f"{v:+.3f}"
                print(f"[debug] head {fmt(dh)} (thr {config.HEAD_DELTA}) "
                      f"eye {fmt(de)} (thr {config.EYE_DELTA}) win={window_reason} cam={cam_reason} {status}")
                next_debug = now + 1.0

            if args.preview and frame is not None:
                bad = status.startswith(("distracted", "slash"))
                color = (0, 0, 255) if bad else (0, 200, 0)
                cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                if det is not None and det.calibrated:
                    dh, de = det.last_deltas
                    txt = (f"head {'--' if dh is None else f'{dh:+.3f}'}/{config.HEAD_DELTA}  "
                           f"eye {'--' if de is None else f'{de:+.3f}'}/{config.EYE_DELTA}")
                    cv2.putText(frame, txt, (10, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
                cv2.imshow("ScrollStake", frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("c") and det is not None:
                    det.recalibrate()
                    was_calibrated = False
                    cam_db.reset()
                    print("Recalibrating: look at your screen normally...")
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
