import { afterEach, describe, expect, it, vi } from "vitest";
import { reportCameraDistraction } from "./camera-report";

afterEach(() => vi.unstubAllGlobals());

describe("reportCameraDistraction", () => {
  it("posts to /api/events exactly as before when no onDistraction callback is set", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "slashed", strikes: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const toast = await reportCameraDistraction({ code: "AB12CD", wallet: "W1", clientToken: "tok" }, "camera:looking_down", 10.04);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-token": "tok" },
      body: JSON.stringify({ code: "AB12CD", wallet: "W1", type: "distraction", source: "camera", reason: "camera:looking_down", category: "camera", confidence: 0.9, durationSec: 10, ts: 1_760_000_000 }),
    });
    expect(toast).toBe("Stake slashed · 1 strike");
  });

  it("surfaces API rejections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error", error: "unauthorized" }), { status: 401 })));
    await expect(reportCameraDistraction({ code: "AB12CD", wallet: "W1", clientToken: "bad" }, "camera:face_missing", 10)).rejects.toThrow("unauthorized");
  });

  it("calls the local callback and makes no network request when onDistraction is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onDistraction = vi.fn();

    await reportCameraDistraction({ onDistraction }, "camera:looking_down", 10.2);

    expect(onDistraction).toHaveBeenCalledWith("camera:looking_down", 10.2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
