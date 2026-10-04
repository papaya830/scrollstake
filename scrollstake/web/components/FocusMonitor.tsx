"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PSM, type Worker } from "tesseract.js";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { classifyNativeAppTitle, classifyOcrText, classifyUnapprovedScreen } from "./screen-policy";
import { activeReasons, combinedReason, summarizeFocus, type FocusSignal } from "./focus-state";

type Props = { code: string; wallet: string; clientToken: string; allowedResources: string[]; graceSeconds?: number; sampleIntervalSeconds?: number; ended?: boolean; onEvent?: () => void };
type EventResponse = { status: "forgiven" | "slashed" | "ignored" | "error"; livesLeft?: number; strikes?: number; error?: string };
type Landmark = { x: number; y: number; z: number };

const JPEG_QUALITY = 0.65;
const MAX_FRAME_WIDTH = 1280;
const MIN_SCREEN_CONFIDENCE = 0.85;
const CAMERA_SAMPLE_MS = 200;
const CALIBRATION_MS = 3_000;
const FACE_MISSING_MS = 4_000;
const HEAD_DELTA = 0.06;
const EYE_DELTA = 0.12;
const SMOOTH_FRAMES = 7;
const COOLDOWN_MS = 15_000;
const HEARTBEAT_MS = 15_000;
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const NOSE = 1, FOREHEAD = 10, CHIN = 152, LEFT_TOP = 159, LEFT_BOTTOM = 145, LEFT_IRIS = 468, RIGHT_TOP = 386, RIGHT_BOTTOM = 374, RIGHT_IRIS = 473;

const idleSignal = (detail: string): FocusSignal => ({ state: "idle", detail });
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const deviation = (values: number[]) => values.length ? Math.sqrt(values.reduce((sum, value) => {
  const mean = values.reduce((inner, item) => inner + item, 0) / values.length;
  return sum + (value - mean) ** 2;
}, 0) / values.length) : 0;

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
      baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "VIDEO", numFaces: 1,
      minFaceDetectionConfidence: 0.7, minFacePresenceConfidence: 0.7, minTrackingConfidence: 0.7,
    });
  } finally {
    console.error = originalError;
  }
}

/** Small JPEG of a video frame for the Wrapped "caught" gallery. */
function grabFrame(video: HTMLVideoElement | null, width: number) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return undefined;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, width / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return undefined;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

export default function FocusMonitor({ code, wallet, clientToken, allowedResources, graceSeconds = 10, sampleIntervalSeconds = 3, ended = false, onEvent }: Props) {
  const [signals, setSignals] = useState({ screen: idleSignal("Screen share is off"), camera: idleSignal("Camera is off") });
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(graceSeconds);
  const [error, setError] = useState("");
  const [eventResult, setEventResult] = useState("");
  const signalRef = useRef(signals);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const ocrWorkerRef = useRef<Worker | null>(null);
  const titleOcrWorkerRef = useRef<Worker | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const screenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzingScreenRef = useRef(false);
  const violationSinceRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);
  const reportingRef = useRef(false);
  const suppressLossRef = useRef(false);
  const unmountingRef = useRef(false);
  const calibrationStartRef = useRef<number | null>(null);
  const calibrationHeadRef = useRef<number[]>([]);
  const calibrationEyeRef = useRef<number[]>([]);
  const baselineRef = useRef<{ head: number; eye: number } | null>(null);
  const headHistoryRef = useRef<number[]>([]);
  const eyeHistoryRef = useRef<number[]>([]);
  const lastFaceRef = useRef(0);

  const setSignal = useCallback((kind: "screen" | "camera", next: FocusSignal) => {
    signalRef.current = { ...signalRef.current, [kind]: next };
    setSignals(signalRef.current);
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    countdownTimerRef.current = null;
    reportTimerRef.current = null;
  }, []);

  const postEvent = useCallback(async (reason: string, durationSec: number) => {
    if (reportingRef.current) return;
    reportingRef.current = true;
    const snapshot = { camera: grabFrame(cameraVideoRef.current, 320), screen: grabFrame(screenVideoRef.current, 480) };
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-token": clientToken },
        body: JSON.stringify({ code, wallet, type: "distraction", source: "focus", reason, category: "combined", confidence: 0.9, durationSec: Math.round(durationSec * 10) / 10, ts: Math.floor(Date.now() / 1000), snapshot }),
      });
      const body = await response.json() as EventResponse;
      if (!response.ok || body.status === "error") throw new Error(body.error ?? "The event API rejected the report.");
      setEventResult(body.status === "slashed" ? `Stake slashed · ${body.strikes ?? 0} strike${body.strikes === 1 ? "" : "s"}` : body.status === "forgiven" ? `Free pass used · ${body.livesLeft ?? 0} left` : "Duplicate event ignored");
      onEvent?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not report the distraction.");
    }
  }, [clientToken, code, onEvent, wallet]);

  const postHeartbeat = useCallback(async () => {
    const current = signalRef.current;
    if (!screenStreamRef.current?.active || !cameraStreamRef.current?.active || current.screen.state !== "focused" || current.camera.state !== "focused") return;
    try {
      await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-token": clientToken },
        body: JSON.stringify({ code, wallet, type: "heartbeat", source: "focus", reason: "focus:locked_in", ts: Math.floor(Date.now() / 1000) }),
      });
    } catch {
      // Analytics must never interrupt local monitoring or a potential slash.
    }
  }, [clientToken, code, wallet]);

  const reconcileCountdown = useCallback(() => {
    const reasons = activeReasons(signalRef.current);
    if (!reasons.length) {
      clearCountdown();
      violationSinceRef.current = null;
      if (Date.now() >= cooldownUntilRef.current) reportingRef.current = false;
      setCountdown(graceSeconds);
      return;
    }
    const now = Date.now();
    if (now < cooldownUntilRef.current || violationSinceRef.current !== null) return;
    violationSinceRef.current = now;
    reportingRef.current = false;
    countdownTimerRef.current = setInterval(() => setCountdown(Math.max(0, Math.ceil(graceSeconds - (Date.now() - now) / 1000))), 250);
    reportTimerRef.current = setTimeout(() => {
      const reason = combinedReason(signalRef.current);
      if (!reason) return;
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      violationSinceRef.current = null;
      setCountdown(0);
      void postEvent(reason, graceSeconds);
    }, graceSeconds * 1000);
  }, [clearCountdown, graceSeconds, postEvent]);

  const updateSignal = useCallback((kind: "screen" | "camera", next: FocusSignal) => {
    setSignal(kind, next);
    reconcileCountdown();
  }, [reconcileCountdown, setSignal]);

  const stopResources = useCallback(() => {
    suppressLossRef.current = true;
    if (screenTimerRef.current) clearInterval(screenTimerRef.current);
    if (cameraTimerRef.current) clearInterval(cameraTimerRef.current);
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    screenTimerRef.current = null;
    cameraTimerRef.current = null;
    heartbeatTimerRef.current = null;
    clearCountdown();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    void ocrWorkerRef.current?.terminate();
    ocrWorkerRef.current = null;
    void titleOcrWorkerRef.current?.terminate();
    titleOcrWorkerRef.current = null;
  }, [clearCountdown]);

  const captureFrame = useCallback(() => {
    const video = screenVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return Math.ceil((frame.split(",")[1]?.length ?? 0) * 0.75) <= 300_000 ? frame : canvas.toDataURL("image/jpeg", 0.45);
  }, []);

  const captureTitleBar = useCallback(() => {
    const video = screenVideoRef.current;
    const canvas = titleCanvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return false;
    // Native-app names live at the top left of macOS/Windows chrome. Crop it
    // before resizing so small labels such as "Discord" remain legible.
    const sourceWidth = Math.min(video.videoWidth, 1400);
    const sourceHeight = Math.min(video.videoHeight, Math.max(56, Math.round(video.videoHeight * 0.1)));
    canvas.width = 2800;
    canvas.height = Math.max(112, Math.round(sourceHeight * 2));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return false;
    context.filter = "grayscale(1) contrast(2.4)";
    context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
    return true;
  }, []);

  const analyzeScreen = useCallback(async () => {
    if (analyzingScreenRef.current || !screenStreamRef.current?.active) return;
    if (!captureFrame()) return;
    analyzingScreenRef.current = true;
    try {
      if (!ocrWorkerRef.current) {
        updateSignal("screen", { state: "connecting", detail: "Loading local text recognition…" });
        const { createWorker } = await import("tesseract.js");
        ocrWorkerRef.current = await createWorker("eng");
      }
      // Inspect the foreground title bar before the full desktop. A full-screen
      // capture can contain background windows whose approved text would otherwise
      // incorrectly clear the app the participant is currently using.
      let result = null;
      if (captureTitleBar()) {
        if (!titleOcrWorkerRef.current) {
          const { createWorker } = await import("tesseract.js");
          titleOcrWorkerRef.current = await createWorker("eng");
          await titleOcrWorkerRef.current.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "300", preserve_interword_spaces: "1" });
        }
        const titleData = await titleOcrWorkerRef.current.recognize(titleCanvasRef.current!);
        // A title bar can identify both configured study apps and native distractions.
        result = classifyOcrText(titleData.data.text, allowedResources) ?? classifyNativeAppTitle(titleData.data.text);
      }
      if (!result) {
        const { data } = await ocrWorkerRef.current.recognize(canvasRef.current!);
        result = classifyOcrText(data.text, allowedResources);
      }
      // This monitor is intentionally an allowlist. Once both recognition passes
      // complete, an unknown or text-free foreground screen is not compliant.
      result ??= classifyUnapprovedScreen();
      if (result?.classification === "disallowed" && result.confidence >= MIN_SCREEN_CONFIDENCE) {
        updateSignal("screen", { state: "violation", detail: result.reason, reason: `screen:${result.category}:${result.matchedResource ?? result.reason}` });
      } else if (result?.classification === "uncertain") {
        updateSignal("screen", { state: "degraded", detail: result.reason });
      } else {
        updateSignal("screen", { state: "focused", detail: result.reason });
      }
      setError("");
    } catch (cause) {
      updateSignal("screen", { state: "degraded", detail: cause instanceof Error ? cause.message : "Screen analysis is unavailable." });
    } finally {
      analyzingScreenRef.current = false;
    }
  }, [allowedResources, captureFrame, captureTitleBar, updateSignal]);

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

  const analyzeCamera = useCallback(() => {
    const video = cameraVideoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      const landmarks = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0] as Landmark[] | undefined;
      const reading = landmarks ? readFace(landmarks) : null;
      const now = Date.now();
      if (!reading) {
        if (baselineRef.current && now - lastFaceRef.current >= FACE_MISSING_MS) updateSignal("camera", { state: "violation", detail: "Face is no longer visible. Return to camera.", reason: "camera:face_missing" });
        return;
      }
      lastFaceRef.current = now;
      if (!baselineRef.current) {
        if (calibrationStartRef.current === null) calibrationStartRef.current = now;
        calibrationHeadRef.current.push(reading.head);
        if (reading.eye !== null) calibrationEyeRef.current.push(reading.eye);
        const elapsed = now - calibrationStartRef.current;
        if (elapsed >= CALIBRATION_MS && calibrationHeadRef.current.length > 10 && calibrationEyeRef.current.length > 5) {
          if (deviation(calibrationHeadRef.current) > 0.03) {
            calibrationStartRef.current = null;
            calibrationHeadRef.current = [];
            calibrationEyeRef.current = [];
            updateSignal("camera", { state: "calibrating", detail: "You moved during calibration. Look at your screen and hold still." });
            return;
          }
          baselineRef.current = { head: median(calibrationHeadRef.current), eye: median(calibrationEyeRef.current) };
          headHistoryRef.current = [];
          eyeHistoryRef.current = [];
          updateSignal("camera", { state: "focused", detail: "Focused. Face position matches your calibration." });
        } else {
          updateSignal("camera", { state: "calibrating", detail: `Calibrating — look at your screen normally (${Math.max(0, Math.ceil((CALIBRATION_MS - elapsed) / 1000))}s)` });
        }
        return;
      }
      headHistoryRef.current = [...headHistoryRef.current, reading.head].slice(-SMOOTH_FRAMES);
      if (reading.eye !== null) eyeHistoryRef.current = [...eyeHistoryRef.current, reading.eye].slice(-SMOOTH_FRAMES);
      const headDelta = median(headHistoryRef.current) - baselineRef.current.head;
      const eyeDelta = eyeHistoryRef.current.length ? median(eyeHistoryRef.current) - baselineRef.current.eye : 0;
      if (Math.abs(headDelta) > HEAD_DELTA || eyeDelta > EYE_DELTA) updateSignal("camera", { state: "violation", detail: "Looking down detected. Return to your screen.", reason: "camera:looking_down" });
      else updateSignal("camera", { state: "focused", detail: "Focused. Face position matches your calibration." });
    } catch (cause) {
      updateSignal("camera", { state: "degraded", detail: "Camera analysis paused. Your preview is still connected." });
      setError(cause instanceof Error ? cause.message : "Could not analyze the camera frame.");
    }
  }, [readFace, updateSignal]);

  const handleStreamLost = useCallback((kind: "screen" | "camera") => {
    if (suppressLossRef.current || unmountingRef.current || ended) return;
    updateSignal(kind, kind === "screen"
      ? { state: "lost", detail: "Screen sharing stopped. Restart monitoring to continue.", reason: "screen:monitoring_lost" }
      : { state: "lost", detail: "Camera stopped. Restart monitoring to continue.", reason: "camera:stream_stopped" });
  }, [ended, updateSignal]);

  const start = useCallback(async () => {
    stopResources();
    setStarted(false);
    setError("");
    setEventResult("");
    setCountdown(graceSeconds);
    setSignal("screen", { state: "connecting", detail: "Choose Entire Screen in the browser picker." });
    setSignal("camera", { state: "connecting", detail: "Allow camera access in Chrome." });
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia) throw new Error("Screen and camera capture require desktop Chrome over HTTPS.");
      const displayOptions = { video: { frameRate: { ideal: 5, max: 10 }, displaySurface: "monitor" }, audio: false, monitorTypeSurfaces: "include", selfBrowserSurface: "exclude" } as DisplayMediaStreamOptions;
      const [screenResult, cameraResult] = await Promise.allSettled([navigator.mediaDevices.getDisplayMedia(displayOptions), navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })]);
      if (screenResult.status !== "fulfilled" || cameraResult.status !== "fulfilled") {
        if (screenResult.status === "fulfilled") screenResult.value.getTracks().forEach((track) => track.stop());
        if (cameraResult.status === "fulfilled") cameraResult.value.getTracks().forEach((track) => track.stop());
        const failure = screenResult.status === "rejected" ? screenResult.reason : cameraResult.status === "rejected" ? cameraResult.reason : null;
        throw failure instanceof Error ? failure : new Error("Both screen sharing and camera access are required.");
      }
      const screenTrack = screenResult.value.getVideoTracks()[0];
      const cameraTrack = cameraResult.value.getVideoTracks()[0];
      if (!screenTrack || !cameraTrack) throw new Error("A screen and camera video track are both required.");
      if (screenTrack.getSettings().displaySurface !== "monitor") {
        screenResult.value.getTracks().forEach((track) => track.stop());
        cameraResult.value.getTracks().forEach((track) => track.stop());
        throw new Error("Select Entire Screen—not a tab or window.");
      }
      screenStreamRef.current = screenResult.value;
      cameraStreamRef.current = cameraResult.value;
      if (screenVideoRef.current) { screenVideoRef.current.srcObject = screenResult.value; await screenVideoRef.current.play(); }
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = cameraResult.value; await cameraVideoRef.current.play(); }
      setSignal("screen", { state: "focused", detail: "Entire screen connected. Checking your study policy locally." });
      setSignal("camera", { state: "calibrating", detail: "Loading local face detection…" });
      landmarkerRef.current = await loadFaceLandmarker();
      calibrationStartRef.current = null;
      calibrationHeadRef.current = [];
      calibrationEyeRef.current = [];
      baselineRef.current = null;
      lastFaceRef.current = Date.now();
      // Keep old tracks' asynchronous ended callbacks suppressed until both
      // replacement streams are installed and their listeners are attached.
      suppressLossRef.current = false;
      screenTrack.addEventListener("ended", () => handleStreamLost("screen"), { once: true });
      cameraTrack.addEventListener("ended", () => handleStreamLost("camera"), { once: true });
      cameraTrack.addEventListener("mute", () => handleStreamLost("camera"), { once: true });
      setStarted(true);
      screenTimerRef.current = setInterval(() => void analyzeScreen(), sampleIntervalSeconds * 1000);
      cameraTimerRef.current = setInterval(analyzeCamera, CAMERA_SAMPLE_MS);
      heartbeatTimerRef.current = setInterval(() => void postHeartbeat(), HEARTBEAT_MS);
      setTimeout(() => void analyzeScreen(), 500);
      setTimeout(analyzeCamera, 100);
    } catch (cause) {
      stopResources();
      setStarted(false);
      setSignal("screen", idleSignal("Screen share is off"));
      setSignal("camera", idleSignal("Camera is off"));
      setError(cause instanceof Error ? cause.message : "Monitoring could not start.");
    }
  }, [analyzeCamera, analyzeScreen, graceSeconds, handleStreamLost, postHeartbeat, sampleIntervalSeconds, setSignal, stopResources]);

  useEffect(() => {
    if (!ended) return;
    unmountingRef.current = true;
    stopResources();
    setStarted(false);
  }, [ended, stopResources]);

  useEffect(() => () => {
    unmountingRef.current = true;
    stopResources();
  }, [stopResources]);

  const summary = summarizeFocus(signals, { started, ended, countdown });
  const restartable = signals.screen.state === "lost" || signals.camera.state === "lost";

  return (
    <section className="card monitor combined-monitor">
      <video ref={screenVideoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <canvas ref={titleCanvasRef} style={{ display: "none" }} />
      <div className="monitor-top"><div><span className="eyebrow">Focus monitor</span><h2 style={{ margin: "8px 0 0" }}>One lock-in signal</h2></div><span className={`status-pill ${summary.state}`}><span className="status-dot" />{summary.state.replace("-", " ")}</span></div>
      <div className="monitor-main" aria-live="polite"><strong className={summary.state === "distracted" ? "countdown" : ""}>{summary.title}</strong><p>{summary.detail}</p>{error && <p className="error">{error}</p>}{eventResult && <div className="event-toast">{eventResult}</div>}</div>
      <div className="focus-signals">
        <div className={`signal-card ${signals.screen.state}`}><span className="eyebrow">Screen</span><strong>{signals.screen.state === "violation" ? "Different app" : signals.screen.state === "focused" ? "Clear" : signals.screen.state}</strong><p>{signals.screen.detail}</p></div>
        <div className={`signal-card camera ${signals.camera.state}`}><div><span className="eyebrow">Camera</span><strong>{signals.camera.state === "violation" ? "Look away" : signals.camera.state === "focused" ? "Focused" : signals.camera.state}</strong><p>{signals.camera.detail}</p></div><div className="focus-preview"><video ref={cameraVideoRef} muted playsInline autoPlay aria-label="Your local camera preview" /></div></div>
      </div>
      <div className="monitor-actions"><p className="fine">Screen text and face landmarks are checked locally. Routine frames are never retained.</p>{(!started || restartable) && !ended && <button className="button primary" onClick={() => void start()}>{restartable ? "Restart monitoring" : "Start focus monitoring"}</button>}</div>
    </section>
  );
}
