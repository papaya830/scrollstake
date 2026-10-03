"""Webcam "looking down at phone" heuristic using MediaPipe face mesh.

We calibrate a baseline while the user looks at their screen, then flag when
either head pitch proxy or iris vertical position deviates from that baseline.
"""
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

import config

# Face mesh landmark indices (refine_landmarks=True gives iris points 468+)
NOSE_TIP, FOREHEAD, CHIN = 1, 10, 152
L_TOP, L_BOTTOM, L_IRIS = 159, 145, 468
R_TOP, R_BOTTOM, R_IRIS = 386, 374, 473


@dataclass
class Reading:
    face: bool
    head: float = 0.0   # nose position within forehead->chin span (0..1)
    eye: float = 0.0    # iris vertical position within eyelids (0 top .. 1 bottom)


class LookDownDetector:
    def __init__(self):
        self.mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.baseline_head: Optional[float] = None
        self.baseline_eye: Optional[float] = None
        self._cal_head, self._cal_eye = [], []
        self._cal_start = time.time()
        self.last_face_seen = time.time()

    def read(self, frame_bgr) -> Reading:
        res = self.mesh.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return Reading(face=False)
        lm = res.multi_face_landmarks[0].landmark
        self.last_face_seen = time.time()

        span = lm[CHIN].y - lm[FOREHEAD].y
        head = (lm[NOSE_TIP].y - lm[FOREHEAD].y) / span if span > 1e-6 else 0.5

        def eye_ratio(top, bottom, iris):
            h = lm[bottom].y - lm[top].y
            return (lm[iris].y - lm[top].y) / h if h > 1e-6 else 0.5

        eye = (eye_ratio(L_TOP, L_BOTTOM, L_IRIS) + eye_ratio(R_TOP, R_BOTTOM, R_IRIS)) / 2
        return Reading(face=True, head=float(head), eye=float(eye))

    @property
    def calibrated(self) -> bool:
        return self.baseline_head is not None

    def calibrate(self, r: Reading) -> bool:
        """Feed readings during startup. Returns True once calibration is done."""
        if self.calibrated:
            return True
        if r.face:
            self._cal_head.append(r.head)
            self._cal_eye.append(r.eye)
        if time.time() - self._cal_start >= config.CALIBRATION_SECONDS and len(self._cal_head) > 10:
            self.baseline_head = float(np.median(self._cal_head))
            self.baseline_eye = float(np.median(self._cal_eye))
            return True
        return False

    def reason(self, r: Reading) -> Optional[str]:
        """Returns a distraction reason or None."""
        if not self.calibrated:
            return None
        if not r.face:
            if time.time() - self.last_face_seen > config.FACE_MISSING_SECONDS:
                return "cam:face_missing"
            return None
        if abs(r.head - self.baseline_head) > config.HEAD_DELTA:
            return "cam:head_moved"
        if r.eye - self.baseline_eye > config.EYE_DELTA:
            return "cam:looking_down"
        return None
