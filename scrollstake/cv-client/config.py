import os

from dotenv import load_dotenv

load_dotenv()

API_URL = os.getenv("API_URL", "http://localhost:3000")
SESSION_CODE = os.getenv("SESSION_CODE", "")
CLIENT_TOKEN = os.getenv("CLIENT_TOKEN", "")
WALLET = os.getenv("WALLET", "")

# Seconds of continuous distraction before we report it (demo: 10, real plan: 60).
GRACE_SECONDS = float(os.getenv("GRACE_SECONDS", "10"))
# After reporting, wait this long before another report can fire.
COOLDOWN_SECONDS = float(os.getenv("COOLDOWN_SECONDS", "15"))

# Seconds of calibration at startup (look at your screen normally).
CALIBRATION_SECONDS = 3.0

# How far head pitch / iris position must move from baseline to count as "looking down".
# Tune these. Bigger = fewer false positives.
HEAD_DELTA = 0.06
EYE_DELTA = 0.12

# Seconds without a detected face before we treat it as "away".
FACE_MISSING_SECONDS = 4.0

CAMERA_INDEX = 0
LOOP_SLEEP = 0.03
