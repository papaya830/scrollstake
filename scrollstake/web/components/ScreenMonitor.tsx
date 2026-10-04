"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { classifyOcrText, isDetectionResult, type DetectionResult } from "./screen-policy";

type MonitorState = "idle" | "requesting" | "monitoring" | "distracted" | "share-lost" | "degraded" | "ended";

type Props = {
  code: string;
  wallet: string;
  clientToken: string;
  allowedResources: string[];
  graceSeconds?: number;
  sampleIntervalSeconds?: number;
  ended?: boolean;
  onEvent?: () => void;
};

type EventResponse = { status: "slashed" | "ignored" | "error"; strikes?: number; error?: string };

const JPEG_QUALITY = 0.65;
const MAX_FRAME_WIDTH = 1280;
const MIN_CONFIDENCE = 0.85;
const COOLDOWN_MS = 15_000;

function approximateDataBytes(dataUrl: string): number {
  return Math.ceil((dataUrl.split(",")[1]?.length ?? 0) * 0.75);
}

export default function ScreenMonitor({
  code,
  wallet,
  clientToken,
  allowedResources,
  graceSeconds = 3,
  sampleIntervalSeconds = 3,
  ended = false,
  onEvent,
}: Props) {
  const [state, setState] = useState<MonitorState>(ended ? "ended" : "idle");
  const [detail, setDetail] = useState("Monitoring is off");
  const [countdown, setCountdown] = useState(graceSeconds);
  const [eventResult, setEventResult] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ocrWorkerRef = useRef<Worker | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzingRef = useRef(false);
  const distractedSinceRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);
  const latestFrameRef = useRef("");
  const unmountingRef = useRef(false);
  const shareLossReportedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
    if (clockTimerRef.current) clearInterval(clockTimerRef.current);
    if (lostTimerRef.current) clearTimeout(lostTimerRef.current);
    sampleTimerRef.current = null;
    clockTimerRef.current = null;
    lostTimerRef.current = null;
  }, []);

  const postEvent = useCallback(async (result: DetectionResult, durationSec: number, evidence?: string) => {
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-token": clientToken },
        body: JSON.stringify({
          code,
          wallet,
          type: "distraction",
          source: "screen",
          reason: `screen:${result.category}:${result.matchedResource ?? result.reason}`,
          category: result.category,
          confidence: result.confidence,
          durationSec: Math.round(durationSec * 10) / 10,
          ts: Math.floor(Date.now() / 1000),
          evidence: evidence ? { mimeType: "image/jpeg", data: evidence, capturedAt: Date.now() } : undefined,
        }),
      });
      const body = await response.json() as EventResponse;
      if (!response.ok || body.status === "error") throw new Error(body.error ?? "The event API rejected the report.");
      const copy = body.status === "slashed"
        ? `Stake slashed · ${body.strikes ?? 0} strike${body.strikes === 1 ? "" : "s"}`
        : "Duplicate event ignored";
      setEventResult(copy);
      onEvent?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not report the distraction.");
    }
  }, [clientToken, code, onEvent, wallet]);

  const handleShareLost = useCallback(() => {
    if (unmountingRef.current || ended) return;
    clearTimers();
    distractedSinceRef.current = Date.now();
    shareLossReportedRef.current = false;
    setState("share-lost");
    setDetail("Screen sharing stopped. Resume before the grace period ends.");
    setCountdown(graceSeconds);
    clockTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - (distractedSinceRef.current ?? Date.now())) / 1000;
      setCountdown(Math.max(0, Math.ceil(graceSeconds - elapsed)));
    }, 250);
    lostTimerRef.current = setTimeout(() => {
      if (shareLossReportedRef.current) return;
      shareLossReportedRef.current = true;
      void postEvent({ classification: "disallowed", category: "other", confidence: 1, matchedResource: "monitoring_lost", reason: "Screen sharing stopped" }, graceSeconds, latestFrameRef.current || undefined);
      setDetail("Monitoring interruption reported. Resume sharing to continue.");
      if (clockTimerRef.current) clearInterval(clockTimerRef.current);
    }, graceSeconds * 1000);
  }, [clearTimers, ended, graceSeconds, postEvent]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return approximateDataBytes(dataUrl) <= 300_000 ? dataUrl : canvas.toDataURL("image/jpeg", 0.45);
  }, []);

  const remoteClassify = useCallback(async (frame: string, ocrText: string): Promise<DetectionResult> => {
    const response = await fetch("/api/screen/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-token": clientToken },
      body: JSON.stringify({
        code,
        wallet,
        capturedAt: Date.now(),
        ocrText: ocrText.slice(0, 4000),
        allowedResources,
        image: {
          mimeType: "image/jpeg",
          data: frame,
          width: canvasRef.current?.width ?? 0,
          height: canvasRef.current?.height ?? 0,
        },
      }),
    });
    if (!response.ok) throw new Error(response.status === 404 ? "Vision classifier is waiting for the backend endpoint." : "Vision classifier is unavailable.");
    const result: unknown = await response.json();
    if (!isDetectionResult(result)) throw new Error("Vision classifier returned an invalid result.");
    return result;
  }, [allowedResources, clientToken, code, wallet]);

  const applyDetection = useCallback((result: DetectionResult, frame: string) => {
    const now = Date.now();
    if (result.classification !== "disallowed" || result.confidence < MIN_CONFIDENCE) {
      distractedSinceRef.current = null;
      setCountdown(graceSeconds);
      setState(result.classification === "uncertain" ? "degraded" : "monitoring");
      setDetail(result.reason);
      return;
    }

    setState("distracted");
    setDetail(result.reason);
    latestFrameRef.current = frame;
    if (now < cooldownUntilRef.current) {
      setCountdown(Math.ceil((cooldownUntilRef.current - now) / 1000));
      return;
    }
    if (distractedSinceRef.current === null) distractedSinceRef.current = now;
    const elapsed = (now - distractedSinceRef.current) / 1000;
    setCountdown(Math.max(0, Math.ceil(graceSeconds - elapsed)));
    if (elapsed >= graceSeconds) {
      cooldownUntilRef.current = now + COOLDOWN_MS;
      distractedSinceRef.current = null;
      void postEvent(result, elapsed, frame);
    }
  }, [graceSeconds, postEvent]);

  const analyze = useCallback(async () => {
    if (analyzingRef.current || !streamRef.current?.active) return;
    const frame = captureFrame();
    if (!frame) return;
    analyzingRef.current = true;
    try {
      if (!ocrWorkerRef.current) {
        setDetail("Loading local text recognition…");
        const { createWorker } = await import("tesseract.js");
        ocrWorkerRef.current = await createWorker("eng");
      }
      const { data } = await ocrWorkerRef.current.recognize(canvasRef.current!);
      const local = classifyOcrText(data.text, allowedResources);
      const result = local ?? await remoteClassify(frame, data.text);
      setError("");
      applyDetection(result, frame);
    } catch (cause) {
      distractedSinceRef.current = null;
      setState("degraded");
      setDetail(cause instanceof Error ? cause.message : "Screen analysis is unavailable.");
      setCountdown(graceSeconds);
    } finally {
      analyzingRef.current = false;
    }
  }, [allowedResources, applyDetection, captureFrame, graceSeconds, remoteClassify]);

  const start = useCallback(async () => {
    setState("requesting");
    setError("");
    setEventResult("");
    setDetail("Choose Entire Screen in the browser picker");
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen capture is not supported in this browser. Use desktop Chrome over HTTPS.");
      const displayOptions = {
        video: { frameRate: { ideal: 5, max: 10 }, displaySurface: "monitor" },
        audio: false,
        monitorTypeSurfaces: "include",
        selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions;
      const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
      const track = stream.getVideoTracks()[0];
      const surface = track.getSettings().displaySurface;
      if (surface !== "monitor") {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error(surface ? "Select Entire Screen—not a tab or window." : "This browser cannot verify entire-screen sharing. Use desktop Chrome.");
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      track.addEventListener("ended", handleShareLost, { once: true });
      distractedSinceRef.current = null;
      cooldownUntilRef.current = 0;
      shareLossReportedRef.current = false;
      setState("monitoring");
      setDetail("Entire screen connected. Checking your study policy locally.");
      setCountdown(graceSeconds);
      sampleTimerRef.current = setInterval(() => void analyze(), sampleIntervalSeconds * 1000);
      setTimeout(() => void analyze(), 500);
    } catch (cause) {
      setState("idle");
      setDetail("Monitoring is off");
      setError(cause instanceof Error ? cause.message : "Screen sharing was not started.");
    }
  }, [analyze, clearTimers, graceSeconds, handleShareLost, sampleIntervalSeconds]);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    handleShareLost();
  }

  useEffect(() => {
    if (ended) {
      unmountingRef.current = true;
      clearTimers();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setState("ended");
      setDetail("This session has ended.");
    }
  }, [clearTimers, ended]);

  useEffect(() => () => {
    unmountingRef.current = true;
    clearTimers();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void ocrWorkerRef.current?.terminate();
  }, [clearTimers]);

  const active = state === "monitoring" || state === "distracted" || state === "degraded";
  const title = state === "distracted" || state === "share-lost"
    ? countdown > 0 ? `${countdown}s` : "Reported"
    : state === "monitoring" ? "Locked in" : state === "degraded" ? "Check paused" : state === "requesting" ? "Choose a screen" : state === "ended" ? "Session over" : "Ready?";

  return (
    <section className="card monitor">
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="monitor-top">
        <div>
          <span className="eyebrow">Screen monitor</span>
          <h2 style={{ margin: "8px 0 0" }}>Focus signal</h2>
        </div>
        <span className={`status-pill ${state}`}><span className="status-dot" />{state.replace("-", " ")}</span>
      </div>
      <div className="monitor-main" aria-live="polite">
        <strong className={state === "distracted" || state === "share-lost" ? "countdown" : ""}>{title}</strong>
        <p>{detail}</p>
        {error && <p className="error">{error}</p>}
        {eventResult && <div className="event-toast">{eventResult}</div>}
      </div>
      <div className="monitor-actions">
        <p className="fine">Frames are sampled every {sampleIntervalSeconds}s. Routine frames are never retained.</p>
        {!active && state !== "ended" && <button className="button primary" onClick={() => void start()}>{state === "share-lost" ? "Resume sharing" : "Start monitoring"}</button>}
        {active && <button className="button" onClick={stop}>Stop sharing</button>}
      </div>
    </section>
  );
}
