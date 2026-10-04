"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { reportCameraDistraction, type CameraReportTarget } from "./camera-report";

type CameraState = "idle" | "requesting" | "calibrating" | "monitoring" | "distracted" | "lost" | "ended" | "degraded";
type Landmark = { x: number; y: number; z: number };
// Either a session (events go to /api/events) or onDistraction (local only, used by /preview).
type Props = { graceSeconds?: number; ended?: boolean; onEvent?: () => void } & (
  | { code: string; wallet: string; clientToken: string; onDistraction?: undefined }
  | { onDistraction: (reason: string, durationSec: number) => void; code?: undefined; wallet?: undefined; clientToken?: undefined }
);

const CALIBRATION_MS = 3_000;
const SAMPLE_MS = 200;
const FACE_MISSING_MS = 4_000;
const HEAD_DELTA = 0.06;
const EYE_DELTA = 0.12;
const SMOOTH_FRAMES = 7;
const COOLDOWN_MS = 15_000;
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

// Same landmarks and thresholds as the desktop CV client.
const NOSE = 1, FOREHEAD = 10, CHIN = 152, LEFT_TOP = 159, LEFT_BOTTOM = 145, LEFT_IRIS = 468, RIGHT_TOP = 386, RIGHT_BOTTOM = 374, RIGHT_IRIS = 473;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const deviation = (values: number[]) => {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

// MediaPipe's Emscripten runtime sends this normal CPU-startup notice through
// console.error. Next's development overlay then incorrectly presents it as an
// application error. Keep all real runtime errors, but silence this one notice.
async function loadFaceLandmarker() {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => String(arg).includes("Created TensorFlow Lite XNNPACK delegate for CPU"))) return;
    originalError(...args);
  };
  try {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    return await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.7,
      minFacePresenceConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });
  } finally {
    console.error = originalError;
  }
}

/** Local-only MediaPipe look-down detector. Camera frames never leave the browser. */
export default function CameraMonitor({ code, wallet, clientToken, onDistraction, graceSeconds = 3, ended = false, onEvent }: Props) {
  const [state, setState] = useState<CameraState>(ended ? "ended" : "idle");
  const [detail, setDetail] = useState("Camera is off");
  const [countdown, setCountdown] = useState(graceSeconds);
  const [error, setError] = useState("");
  const [eventResult, setEventResult] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lossTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const calibrationStartedRef = useRef<number | null>(null);
  const calibrationHeadRef = useRef<number[]>([]);
  const calibrationEyeRef = useRef<number[]>([]);
  const baselineRef = useRef<{ head: number; eye: number } | null>(null);
  const headHistoryRef = useRef<number[]>([]);
  const eyeHistoryRef = useRef<number[]>([]);
  const lastFaceRef = useRef(0);
  const distractionSinceRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);
  const reportingRef = useRef(false);
  const unmountingRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current);
    if (clockTimerRef.current) clearInterval(clockTimerRef.current);
    sampleTimerRef.current = null;
    lossTimerRef.current = null;
    clockTimerRef.current = null;
  }, []);

  const postEvent = useCallback(async (reason: string, durationSec: number) => {
    if (reportingRef.current) return;
    reportingRef.current = true;
    try {
      const target: CameraReportTarget = onDistraction ? { onDistraction } : { code: code!, wallet: wallet!, clientToken: clientToken! };
      setEventResult(await reportCameraDistraction(target, reason, durationSec));
      onEvent?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not report the camera interruption.");
    }
  }, [clientToken, code, onDistraction, onEvent, wallet]);

  const resetFocus = useCallback(() => {
    distractionSinceRef.current = null;
    if (Date.now() >= cooldownUntilRef.current) reportingRef.current = false;
    setCountdown(graceSeconds);
    setState("monitoring");
    setDetail("Focused. Face position matches your calibration.");
  }, [graceSeconds]);

  const reportSignal = useCallback((reason: "camera:looking_down" | "camera:face_missing") => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) return;
    if (distractionSinceRef.current === null) distractionSinceRef.current = now;
    const elapsed = (now - distractionSinceRef.current) / 1000;
    setState("distracted");
    setDetail(reason === "camera:looking_down" ? "Looking down detected. Return to your screen." : "Face is no longer visible. Return to camera.");
    setCountdown(Math.max(0, Math.ceil(graceSeconds - elapsed)));
    if (elapsed >= graceSeconds) {
      cooldownUntilRef.current = now + COOLDOWN_MS;
      distractionSinceRef.current = null;
      void postEvent(reason, elapsed);
    }
  }, [graceSeconds, postEvent]);

  const handleCameraLost = useCallback(() => {
    if (unmountingRef.current || ended) return;
    clearTimers();
    reportingRef.current = false;
    setState("lost");
    setDetail("Camera stopped. Resume before the grace period ends.");
    setCountdown(graceSeconds);
    const lostAt = Date.now();
    clockTimerRef.current = setInterval(() => setCountdown(Math.max(0, Math.ceil(graceSeconds - (Date.now() - lostAt) / 1000))), 250);
    lossTimerRef.current = setTimeout(() => {
      void postEvent("camera:stream_stopped", graceSeconds);
      if (clockTimerRef.current) clearInterval(clockTimerRef.current);
      setDetail("Camera interruption reported. Turn it back on to continue.");
    }, graceSeconds * 1000);
  }, [clearTimers, ended, graceSeconds, postEvent]);

  const readFace = useCallback((landmarks: Landmark[]) => {
    const required = [NOSE, FOREHEAD, CHIN, LEFT_TOP, LEFT_BOTTOM, LEFT_IRIS, RIGHT_TOP, RIGHT_BOTTOM, RIGHT_IRIS];
    if (required.some((index) => !landmarks[index])) return null;
    const span = landmarks[CHIN].y - landmarks[FOREHEAD].y;
    if (span <= 0.00001) return null;
    const head = (landmarks[NOSE].y - landmarks[FOREHEAD].y) / span;
    const leftOpening = landmarks[LEFT_BOTTOM].y - landmarks[LEFT_TOP].y;
    const rightOpening = landmarks[RIGHT_BOTTOM].y - landmarks[RIGHT_TOP].y;
    const eyeOpen = ((leftOpening + rightOpening) / 2) / span;
    const leftEye = leftOpening > 0.00001 ? (landmarks[LEFT_IRIS].y - landmarks[LEFT_TOP].y) / leftOpening : 0.5;
    const rightEye = rightOpening > 0.00001 ? (landmarks[RIGHT_IRIS].y - landmarks[RIGHT_TOP].y) / rightOpening : 0.5;
    return { head, eye: eyeOpen >= 0.025 ? (leftEye + rightEye) / 2 : null };
  }, []);

  const analyze = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      const landmarks = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] as Landmark[] | undefined;
      const reading = landmarks ? readFace(landmarks) : null;
      const now = Date.now();
      if (!reading) {
        if (baselineRef.current && now - lastFaceRef.current >= FACE_MISSING_MS) reportSignal("camera:face_missing");
        return;
      }
      lastFaceRef.current = now;
      if (!baselineRef.current) {
        if (calibrationStartedRef.current === null) calibrationStartedRef.current = now;
        calibrationHeadRef.current.push(reading.head);
        if (reading.eye !== null) calibrationEyeRef.current.push(reading.eye);
        const elapsed = now - calibrationStartedRef.current;
        setState("calibrating");
        setDetail(`Calibrating — look at your screen normally (${Math.max(0, Math.ceil((CALIBRATION_MS - elapsed) / 1000))}s)`);
        if (elapsed >= CALIBRATION_MS && calibrationHeadRef.current.length > 10 && calibrationEyeRef.current.length > 5) {
          if (deviation(calibrationHeadRef.current) > 0.03) {
            calibrationStartedRef.current = null;
            calibrationHeadRef.current = [];
            calibrationEyeRef.current = [];
            setDetail("You moved during calibration. Hold still and look at your screen.");
            return;
          }
          baselineRef.current = { head: median(calibrationHeadRef.current), eye: median(calibrationEyeRef.current) };
          headHistoryRef.current = [];
          eyeHistoryRef.current = [];
          resetFocus();
        }
        return;
      }
      headHistoryRef.current = [...headHistoryRef.current, reading.head].slice(-SMOOTH_FRAMES);
      if (reading.eye !== null) eyeHistoryRef.current = [...eyeHistoryRef.current, reading.eye].slice(-SMOOTH_FRAMES);
      const headDelta = median(headHistoryRef.current) - baselineRef.current.head;
      const eyeDelta = eyeHistoryRef.current.length ? median(eyeHistoryRef.current) - baselineRef.current.eye : 0;
      if (Math.abs(headDelta) > HEAD_DELTA || eyeDelta > EYE_DELTA) reportSignal("camera:looking_down");
      else resetFocus();
    } catch (cause) {
      setState("degraded");
      setDetail("Camera analysis paused. Your video is still connected.");
      setError(cause instanceof Error ? cause.message : "Could not analyze the camera frame.");
    }
  }, [readFace, reportSignal, resetFocus]);

  const start = useCallback(async () => {
    setState("requesting");
    setDetail("Allow camera access in Chrome");
    setError("");
    setEventResult("");
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera capture is not supported in this browser. Use desktop Chrome over HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No video camera was found.");
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("calibrating");
      setDetail("Loading local face detection…");
      landmarkerRef.current = await loadFaceLandmarker();
      calibrationStartedRef.current = null;
      calibrationHeadRef.current = [];
      calibrationEyeRef.current = [];
      baselineRef.current = null;
      lastFaceRef.current = Date.now();
      reportingRef.current = false;
      track.addEventListener("ended", handleCameraLost, { once: true });
      track.addEventListener("mute", handleCameraLost, { once: true });
      sampleTimerRef.current = setInterval(analyze, SAMPLE_MS);
      setTimeout(analyze, 100);
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setState("idle");
      setDetail("Camera is off");
      setError(cause instanceof Error ? cause.message : "Camera access was not started.");
    }
  }, [analyze, clearTimers, handleCameraLost]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    handleCameraLost();
  }, [handleCameraLost]);

  useEffect(() => {
    if (!ended) return;
    unmountingRef.current = true;
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close();
    setState("ended");
    setDetail("This session has ended.");
  }, [clearTimers, ended]);

  useEffect(() => () => {
    unmountingRef.current = true;
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close();
  }, [clearTimers]);

  const active = ["calibrating", "monitoring", "distracted", "degraded"].includes(state);
  const title = state === "lost" || state === "distracted" ? (countdown > 0 ? `${countdown}s` : "Reported") : state === "calibrating" ? "Calibrating" : state === "monitoring" ? "Locked in" : state === "degraded" ? "Check paused" : state === "requesting" ? "Allow access" : state === "ended" ? "Session over" : "Ready?";

  return (
    <section className="card camera-monitor">
      <div className="monitor-top"><div><span className="eyebrow">Camera monitor</span><h2 style={{ margin: "8px 0 0" }}>Focus signal</h2></div><span className={`status-pill ${state}`}><span className="status-dot" />{state === "lost" ? "camera lost" : state}</span></div>
      <div className="camera-content"><div className="camera-preview"><video ref={videoRef} className={active ? undefined : "camera-video-hidden"} muted playsInline autoPlay aria-label="Your local camera preview" />{!active && <div className="camera-placeholder">◉</div>}</div><div className="camera-copy" aria-live="polite"><strong className={state === "lost" || state === "distracted" ? "countdown" : ""}>{title}</strong><p>{detail}</p>{error && <p className="error">{error}</p>}{eventResult && <div className="event-toast">{eventResult}</div>}</div></div>
      <div className="monitor-actions"><p className="fine">MediaPipe analyzes the local preview only. We keep your screen-facing baseline, then give you {graceSeconds}s to return if you look down or leave the camera.</p>{!active && state !== "ended" && <button className="button primary" onClick={() => void start()}>{state === "lost" ? "Resume camera" : "Turn on camera"}</button>}{active && <button className="button" onClick={stop}>Turn off camera</button>}</div>
    </section>
  );
}
