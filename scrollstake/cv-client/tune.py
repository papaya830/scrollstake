"""Guided threshold tuning from YOUR face, camera and lighting.

    python tune.py

Phase 1 (45 s): work normally. Read, type, glance at a second monitor, stretch, blink.
Phase 2 (15 s): look down at your phone in your lap, the way you would while scrolling.

It prints suggested HEAD_DELTA / EYE_DELTA / HEAD_SIGN / CAM_MODE for your .env, and writes
them to .env.tuned. Thresholds are set above what you do during NORMAL work (so false slashes
are rare) and then checked against the phone phase to see whether the signal separates at all.
"""
import time
from typing import Dict, List

import numpy as np

NORMAL_SECONDS = 45
PHONE_SECONDS = 15
MARGIN = 1.3  # threshold = 99.5th percentile of normal behaviour * MARGIN


def recommend(normal_head: List[float], normal_eye: List[float],
              phone_head: List[float], phone_eye: List[float]) -> Dict:
    """Pure function (unit-testable). Inputs are signed deltas vs the baseline."""
    nh, ne = np.array(normal_head), np.array(normal_eye)
    ph, pe = np.array(phone_head), np.array(phone_eye)

    # Direction of the head signal while looking at the phone.
    sign = 0
    if len(ph) and abs(np.median(ph)) > 0.02:
        sign = 1 if np.median(ph) > 0 else -1

    def thr_head():
        base = np.abs(nh) if sign == 0 else np.clip(nh * sign, 0, None)
        return float(max(np.percentile(base, 99.5) * MARGIN, 0.03)) if len(base) else 0.06

    def thr_eye():
        base = np.clip(ne, 0, None)
        return float(max(np.percentile(base, 99.5) * MARGIN, 0.03)) if len(base) else 0.12

    head_thr, eye_thr = thr_head(), thr_eye()

    phone_head_sig = np.abs(ph) if sign == 0 else np.clip(ph * sign, 0, None)
    head_rate = float(np.mean(phone_head_sig > head_thr)) if len(ph) else 0.0
    eye_rate = float(np.mean(pe > eye_thr)) if len(pe) else 0.0
    normal_head_fp = float(np.mean((np.abs(nh) if sign == 0 else nh * sign) > head_thr)) if len(nh) else 0.0
    normal_eye_fp = float(np.mean(ne > eye_thr)) if len(ne) else 0.0

    notes = []
    if head_rate < 0.5:
        notes.append("Head signal rarely exceeds the threshold while you look at your phone; "
                     "it won't catch you reliably (fine: window signal is primary).")
    if eye_rate < 0.5:
        notes.append("Eye signal rarely exceeds the threshold at the phone (glasses / lighting?). "
                     "Consider CAM_MODE=either and rely on the head signal.")
    both = head_rate >= 0.5 and eye_rate >= 0.5
    return {
        "HEAD_DELTA": round(head_thr, 3), "EYE_DELTA": round(eye_thr, 3),
        "HEAD_SIGN": sign, "CAM_MODE": "either",
        "phone_head_hit_rate": head_rate, "phone_eye_hit_rate": eye_rate,
        "normal_head_fp_rate": normal_head_fp, "normal_eye_fp_rate": normal_eye_fp,
        "both_usable": both, "notes": notes,
    }


def _collect(cap, det, seconds: int, label: str):
    heads, eyes = [], []
    end = time.time() + seconds
    last_print = 0.0
    while time.time() < end:
        ok, frame = cap.read()
        if not ok:
            continue
        r = det.read(frame)
        if r.face:
            det.reason(r)  # updates det.last_deltas (smoothed)
            dh, de = det.last_deltas
            if dh is not None:
                heads.append(dh)
            if de is not None:
                eyes.append(de)
        if time.time() - last_print > 5:
            print(f"  {label}: {int(end - time.time())}s left")
            last_print = time.time()
    return heads, eyes


def main() -> None:
    import cv2
    from main import open_camera
    from detector import LookDownDetector
    import config

    cap = open_camera(config.CAMERA_INDEX)
    if not cap.isOpened():
        raise SystemExit("Could not open webcam.")
    det = LookDownDetector()

    print("Calibrating: look at your screen normally...")
    while not det.calibrated:
        ok, frame = cap.read()
        if ok:
            det.calibrate(det.read(frame))

    print(f"\nPHASE 1: work NORMALLY for {NORMAL_SECONDS}s (read, type, glance at 2nd monitor, stretch).")
    time.sleep(2)
    nh, ne = _collect(cap, det, NORMAL_SECONDS, "normal")

    input("\nPress Enter, then LOOK DOWN at your phone for 15s as if scrolling...")
    ph, pe = _collect(cap, det, PHONE_SECONDS, "phone")
    cap.release()

    rec = recommend(nh, ne, ph, pe)
    print("\n=== Results ===")
    print(f"samples: normal {len(nh)}, phone {len(ph)}")
    print(f"normal-work false positives at these thresholds: head {rec['normal_head_fp_rate']:.1%}, "
          f"eye {rec['normal_eye_fp_rate']:.1%}")
    print(f"phone detection rate: head {rec['phone_head_hit_rate']:.0%}, eye {rec['phone_eye_hit_rate']:.0%}")
    for n in rec["notes"]:
        print("NOTE:", n)
    lines = [f"HEAD_DELTA={rec['HEAD_DELTA']}", f"EYE_DELTA={rec['EYE_DELTA']}",
             f"HEAD_SIGN={rec['HEAD_SIGN']}", f"CAM_MODE={rec['CAM_MODE']}"]
    print("\nAdd to .env:\n  " + "\n  ".join(lines))
    with open(".env.tuned", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("(also written to .env.tuned)")


if __name__ == "__main__":
    main()
