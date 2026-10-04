"""Webcam "looking down at phone" heuristic using MediaPipe face mesh.

We calibrate a baseline while the user looks at their screen, then flag when
head pitch proxy or iris vertical position deviates from that baseline.

False-positive defences (see config.py):
  * median filter over the last SMOOTH_FRAMES readings
  * eye reading ignored while blinking / squinting (eyelid opening too small)
  * optional head direction (HEAD_SIGN) so looking UP / stretching does not count
  * CAM_MODE="both" requires head AND eyes
  * calibration clock starts at first face, and is restarted if the user moved a lot
"""
import os
import time
import urllib.request
from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np

import config

# Face mesh landmark indices (refine_landmarks=True gives iris points 468+)
NOSE_TIP, FOREHEAD, CHIN = 1, 10, 152
L_TOP, L_BOTTOM, L_IRIS = 159, 145, 468
R_TOP, R_BOTTOM, R_IRIS = 386, 374, 473

MODEL_DIR = os.path.dirname(__file__)
PHONE_MODEL_PATH = os.path.join(MODEL_DIR, "efficientdet_lite0.tflite")


@dataclass
class Reading:
    face: bool
    head: float = 0.0       # nose position within forehead->chin span (0..1)
    eye: Optional[float] = None  # iris vertical position in eyelids (0 top .. 1 bottom); None while blinking
    eye_open: float = 0.0   # eyelid opening as fraction of face height (diagnostic)
    phone_detected: bool = False
    phone_confidence: float = 0.0


def _median(d: Deque[float]) -> Optional[float]:
    return float(np.median(d)) if d else None


class PhoneDetector:
    """Detects cell phones in webcam frames using MediaPipe Object Detector."""

    def __init__(self):
        self.detector = None
        self._init_detector()

    def _init_detector(self) -> None:
        try:
            if not os.path.exists(PHONE_MODEL_PATH):
                print(f"[phone] Downloading object detector model to {PHONE_MODEL_PATH}...")
                urllib.request.urlretrieve(config.PHONE_MODEL_URL, PHONE_MODEL_PATH)
                print("[phone] Download completed successfully.")

            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision

            base_options = mp_python.BaseOptions(model_asset_path=PHONE_MODEL_PATH)
            options = vision.ObjectDetectorOptions(
                base_options=base_options,
                score_threshold=config.PHONE_CONFIDENCE_THRESHOLD,
                max_results=5,
            )
            self.detector = vision.ObjectDetector.create_from_options(options)
            print("[phone] Phone detector initialized.")
        except Exception as e:
            print(f"[phone] Could not initialize phone detector: {e}")
            self.detector = None

    def detect(self, frame_bgr) -> Tuple[bool, float]:
        if self.detector is None:
            return False, 0.0
        try:
            rgb_frame = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            result = self.detector.detect(mp_image)
            max_conf = 0.0
            phone_found = False
            for detection in result.detections:
                for category in detection.categories:
                    cat_name = (category.category_name or "").lower()
                    if cat_name in ("cell phone", "mobile phone", "phone") and category.score >= config.PHONE_CONFIDENCE_THRESHOLD:
                        phone_found = True
                        if category.score > max_conf:
                            max_conf = category.score
            return phone_found, float(max_conf)
        except Exception as e:
            return False, 0.0


class LookDownDetector:
    def __init__(self):
        self.mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.phone_detector = PhoneDetector() if config.DETECT_PHONE else None
        self._head_hist: Deque[float] = deque(maxlen=max(1, config.SMOOTH_FRAMES))
        self._eye_hist: Deque[float] = deque(maxlen=max(1, config.SMOOTH_FRAMES))
        self.last_face_seen = time.time()
        self.recalibrate()

    # ------------------------------------------------------------------ #
    def recalibrate(self) -> None:
        self.baseline_head: Optional[float] = None
        self.baseline_eye: Optional[float] = None
        self._cal_head, self._cal_eye = [], []
        self._cal_start: Optional[float] = None  # set on first face seen
        self.last_deltas: Tuple[Optional[float], Optional[float]] = (None, None)
        self._head_hist.clear()
        self._eye_hist.clear()

    @property
    def calibrated(self) -> bool:
        return self.baseline_head is not None

    # ------------------------------------------------------------------ #
    def read(self, frame_bgr) -> Reading:
        phone_detected, phone_confidence = False, 0.0
        if self.phone_detector is not None:
            phone_detected, phone_confidence = self.phone_detector.detect(frame_bgr)

        res = self.mesh.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return Reading(face=False, phone_detected=phone_detected, phone_confidence=phone_confidence)
        lm = res.multi_face_landmarks[0].landmark
        self.last_face_seen = time.time()

        span = lm[CHIN].y - lm[FOREHEAD].y
        if span <= 1e-6:
            return Reading(face=False, phone_detected=phone_detected, phone_confidence=phone_confidence)
        head = (lm[NOSE_TIP].y - lm[FOREHEAD].y) / span

        def lid(top, bottom, iris):
            h = lm[bottom].y - lm[top].y
            return h, ((lm[iris].y - lm[top].y) / h if h > 1e-6 else 0.5)

        hl, el = lid(L_TOP, L_BOTTOM, L_IRIS)
        hr, er = lid(R_TOP, R_BOTTOM, R_IRIS)
        eye_open = ((hl + hr) / 2) / span
        eye = (el + er) / 2 if eye_open >= config.MIN_EYE_OPEN else None  # blink/squint: ignore
        return Reading(
            face=True,
            head=float(head),
            eye=None if eye is None else float(eye),
            eye_open=float(eye_open),
            phone_detected=phone_detected,
            phone_confidence=phone_confidence,
        )

    # ------------------------------------------------------------------ #
    def calibrate(self, r: Reading) -> bool:
        """Feed readings during startup. Returns True once calibration is done."""
        if self.calibrated:
            return True
        if r.face:
            if self._cal_start is None:
                self._cal_start = time.time()
            self._cal_head.append(r.head)
            if r.eye is not None:
                self._cal_eye.append(r.eye)
        if (
            self._cal_start is not None
            and time.time() - self._cal_start >= config.CALIBRATION_SECONDS
            and len(self._cal_head) > 10
            and len(self._cal_eye) > 5
        ):
            if np.std(self._cal_head) > 0.03:  # user was moving around: start over
                print("[cal] too much movement during calibration, retrying...")
                self._cal_start, self._cal_head, self._cal_eye = None, [], []
                return False
            self.baseline_head = float(np.median(self._cal_head))
            self.baseline_eye = float(np.median(self._cal_eye))
            print(f"[cal] baseline head={self.baseline_head:.3f} eye={self.baseline_eye:.3f}")
            return True
        return False

    # ------------------------------------------------------------------ #
    def deltas(self, r: Reading) -> Tuple[Optional[float], Optional[float]]:
        """Smoothed (signed head delta, eye delta) vs baseline. None if unavailable."""
        if not self.calibrated or not r.face:
            return None, None
        self._head_hist.append(r.head)
        if r.eye is not None:
            self._eye_hist.append(r.eye)
        h, e = _median(self._head_hist), _median(self._eye_hist)
        return (
            None if h is None else h - self.baseline_head,
            None if e is None else e - self.baseline_eye,
        )

    def reason(self, r: Reading) -> Optional[str]:
        """Returns a distraction reason or None. Call once per frame."""
        if r.phone_detected:
            return "cam:phone_detected"

        if not self.calibrated:
            return None
        if not r.face:
            if time.time() - self.last_face_seen > config.FACE_MISSING_SECONDS:
                return "cam:face_missing"
            return None

        dh, de = self.deltas(r)
        self.last_deltas = (dh, de)  # for the preview overlay / tune.py (don't call deltas() twice)
        if config.HEAD_SIGN:
            head_hit = dh is not None and dh * config.HEAD_SIGN > config.HEAD_DELTA
        else:
            head_hit = dh is not None and abs(dh) > config.HEAD_DELTA
        eye_hit = de is not None and de > config.EYE_DELTA

        if config.CAM_MODE == "both":
            return "cam:looking_down" if (head_hit and eye_hit) else None
        if head_hit:
            return "cam:head_moved"
        if eye_hit:
            return "cam:looking_down"
        return None

