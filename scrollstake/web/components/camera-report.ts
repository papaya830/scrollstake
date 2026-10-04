type EventResponse = { status: "forgiven" | "slashed" | "ignored" | "error"; livesLeft?: number; strikes?: number; error?: string };

/** Where a camera distraction goes: a local callback (preview) or the session event API. */
export type CameraReportTarget =
  | { onDistraction: (reason: string, durationSec: number) => void }
  | { code: string; wallet: string; clientToken: string };

/** Reports one camera distraction and returns the toast text. A local callback never touches the network. */
export async function reportCameraDistraction(target: CameraReportTarget, reason: string, durationSec: number): Promise<string> {
  if ("onDistraction" in target) {
    target.onDistraction(reason, durationSec);
    return "Caught (preview only)";
  }
  const { code, wallet, clientToken } = target;
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-token": clientToken },
    body: JSON.stringify({ code, wallet, type: "distraction", source: "camera", reason, category: "camera", confidence: 0.9, durationSec: Math.round(durationSec * 10) / 10, ts: Math.floor(Date.now() / 1000) }),
  });
  const body = await response.json() as EventResponse;
  if (!response.ok || body.status === "error") throw new Error(body.error ?? "The event API rejected the camera report.");
  return body.status === "slashed" ? `Stake slashed · ${body.strikes ?? 0} strike${body.strikes === 1 ? "" : "s"}` : body.status === "forgiven" ? `Free pass used · ${body.livesLeft ?? 0} left` : "Duplicate event ignored";
}
