import { describe, expect, it } from "vitest";
import { activeReasons, combinedReason, summarizeFocus, type FocusSignal } from "./focus-state";

const clear: FocusSignal = { state: "focused", detail: "Focused" };
const screenViolation: FocusSignal = { state: "violation", detail: "Social activity detected: instagram", reason: "screen:social:instagram" };
const unapprovedScreen: FocusSignal = { state: "violation", detail: "Unapproved screen detected", reason: "screen:other:unapproved_screen" };
const cameraViolation: FocusSignal = { state: "violation", detail: "Looking down detected", reason: "camera:looking_down" };

describe("unified focus state", () => {
  it("stays locked in when both signals are clear", () => {
    expect(summarizeFocus({ screen: clear, camera: clear }, { started: true, ended: false, countdown: 10 })).toMatchObject({ state: "monitoring", title: "Locked in" });
  });

  it("starts the same countdown for either individual signal", () => {
    expect(summarizeFocus({ screen: screenViolation, camera: clear }, { started: true, ended: false, countdown: 9 })).toMatchObject({ state: "distracted", title: "9s" });
    expect(summarizeFocus({ screen: clear, camera: cameraViolation }, { started: true, ended: false, countdown: 9 })).toMatchObject({ state: "distracted", title: "9s" });
  });

  it("starts the shared countdown for an unapproved screen", () => {
    expect(activeReasons({ screen: unapprovedScreen, camera: clear })).toEqual(["screen:other:unapproved_screen"]);
    expect(summarizeFocus({ screen: unapprovedScreen, camera: clear }, { started: true, ended: false, countdown: 10 })).toMatchObject({ state: "distracted", title: "10s" });
  });

  it("keeps the shared countdown active until every signal clears", () => {
    expect(activeReasons({ screen: clear, camera: cameraViolation })).toEqual(["camera:looking_down"]);
    expect(summarizeFocus({ screen: clear, camera: cameraViolation }, { started: true, ended: false, countdown: 4 }).state).toBe("distracted");
  });

  it("records every active signal in one event reason", () => {
    expect(combinedReason({ screen: screenViolation, camera: cameraViolation })).toBe("screen:social:instagram | camera:looking_down");
  });

  it("does not make a degraded signal a penalty", () => {
    expect(summarizeFocus({ screen: { state: "degraded", detail: "OCR unavailable" }, camera: clear }, { started: true, ended: false, countdown: 10 })).toMatchObject({ state: "degraded", title: "Check paused" });
  });
});
