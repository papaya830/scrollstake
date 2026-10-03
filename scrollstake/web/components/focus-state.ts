export type FocusSignalState = "idle" | "connecting" | "calibrating" | "focused" | "violation" | "degraded" | "lost";

export type FocusSignal = {
  state: FocusSignalState;
  detail: string;
  reason?: string;
};

export type FocusSummary = {
  state: "idle" | "connecting" | "calibrating" | "monitoring" | "distracted" | "degraded" | "ended";
  title: string;
  detail: string;
};

export function activeReasons(signals: { screen: FocusSignal; camera: FocusSignal }): string[] {
  return [signals.screen, signals.camera].flatMap((signal) => signal.state === "violation" || signal.state === "lost"
    ? signal.reason ? [signal.reason] : []
    : []);
}

export function combinedReason(signals: { screen: FocusSignal; camera: FocusSignal }): string {
  return activeReasons(signals).join(" | ");
}

export function summarizeFocus(signals: { screen: FocusSignal; camera: FocusSignal }, options: { started: boolean; ended: boolean; countdown: number }): FocusSummary {
  if (options.ended) return { state: "ended", title: "Session over", detail: "This session has ended." };
  if (!options.started) return { state: "idle", title: "Ready?", detail: "Start screen sharing and camera monitoring together." };
  const reasons = activeReasons(signals);
  if (reasons.length) return { state: "distracted", title: options.countdown > 0 ? `${options.countdown}s` : "Reported", detail: signals.screen.state === "violation" || signals.screen.state === "lost" ? signals.screen.detail : signals.camera.detail };
  if (signals.camera.state === "calibrating") return { state: "calibrating", title: "Calibrating", detail: signals.camera.detail };
  if (signals.screen.state === "connecting" || signals.camera.state === "connecting") return { state: "connecting", title: "Connecting", detail: "Connecting your screen and camera." };
  if (signals.screen.state === "degraded" || signals.camera.state === "degraded") return { state: "degraded", title: "Check paused", detail: signals.screen.state === "degraded" ? signals.screen.detail : signals.camera.detail };
  return { state: "monitoring", title: "Locked in", detail: "Your screen and camera signals are clear." };
}
