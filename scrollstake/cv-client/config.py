import os

from dotenv import load_dotenv

load_dotenv()


def _f(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


API_URL = os.getenv("API_URL", "http://localhost:3000")
SESSION_CODE = os.getenv("SESSION_CODE", "")
CLIENT_TOKEN = os.getenv("CLIENT_TOKEN", "")
WALLET = os.getenv("WALLET", "")

# Seconds of continuous distraction before we report it (demo: 10, real plan: 60).
GRACE_SECONDS = _f("GRACE_SECONDS", 10)
# After reporting, wait this long before another report can fire.
COOLDOWN_SECONDS = _f("COOLDOWN_SECONDS", 15)

# Seconds of calibration at startup (look at your screen normally).
# The clock starts when the first face is seen, not at program start.
CALIBRATION_SECONDS = _f("CALIBRATION_SECONDS", 3.0)

# How far head pitch / iris position must move from baseline to count as "looking down".
# Bigger = fewer false positives. Run `python tune.py` to derive these from your own face.
HEAD_DELTA = _f("HEAD_DELTA", 0.06)
EYE_DELTA = _f("EYE_DELTA", 0.12)
# Direction of the head signal when looking down: +1, -1, or 0 = either direction.
# tune.py works this out; with 0, leaning back / looking up also counts (more false positives).
HEAD_SIGN = int(_f("HEAD_SIGN", 0))
# "either": head OR eyes past threshold. "both": head AND eyes (fewest false positives;
# but with glasses/bad light the eye signal can be flaky, so the cam signal may never fire).
CAM_MODE = os.getenv("CAM_MODE", "either")

# --- Noise rejection (all aimed at preferring false negatives) ---------------
# Median filter length (frames) applied to head/eye readings.
SMOOTH_FRAMES = int(_f("SMOOTH_FRAMES", 7))
# Eyelid opening below this fraction of face height = blink / squint: eye reading ignored.
MIN_EYE_OPEN = _f("MIN_EYE_OPEN", 0.025)
# A webcam reason must hold this long before it counts as "distracted"...
CAM_ON_AFTER = _f("CAM_ON_AFTER", 1.5)
# ...and must be gone this long before the streak is considered broken.
CAM_OFF_AFTER = _f("CAM_OFF_AFTER", 1.5)
# Window title can flicker while a page loads; bridge gaps up to this long.
WINDOW_OFF_AFTER = _f("WINDOW_OFF_AFTER", 1.0)
# How often to query the active window (seconds); the OS call is slowish on Windows.
WINDOW_POLL_SECONDS = _f("WINDOW_POLL_SECONDS", 0.4)

# Seconds without a detected face before we treat it as "away".
FACE_MISSING_SECONDS = _f("FACE_MISSING_SECONDS", 4.0)

CAMERA_INDEX = int(_f("CAMERA_INDEX", 0))
LOOP_SLEEP = 0.03

# Extra comma-separated lowercase keywords, no code edit needed.
EXTRA_DISTRACTING = os.getenv("EXTRA_DISTRACTING", "")
EXTRA_ALLOW = os.getenv("EXTRA_ALLOW", "")

# Cell phone detection settings
DETECT_PHONE = os.getenv("DETECT_PHONE", "true").lower() in ("1", "true", "yes")
PHONE_CONFIDENCE_THRESHOLD = _f("PHONE_CONFIDENCE_THRESHOLD", 0.45)
PHONE_MODEL_URL = os.getenv(
    "PHONE_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/latest/efficientdet_lite0.tflite"
)

