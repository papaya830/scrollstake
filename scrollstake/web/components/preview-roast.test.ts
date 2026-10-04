import { describe, expect, it, vi } from "vitest";
import { buildPreviewRoast, buildPreviewTtsText, formatPenalty, playPreviewAlert, PREVIEW_ROAST_COUNT, speakRoast } from "./preview-roast";

describe("preview roast", () => {
  it("prefixes every roast as a test, names the user, and ends with lock in", () => {
    expect(buildPreviewRoast("Dave", 0.5, 0)).toMatch(/^This is a test, but Dave would've just lost 50 cents\. .+ Now lock in!$/);
  });

  it("falls back to 'you' when no name is given", () => {
    expect(buildPreviewRoast("   ", 0.5, PREVIEW_ROAST_COUNT - 1)).toMatch(/^This is a test, but you would've just lost 50 cents\./);
  });

  it("speaks the same words as shown, plus ElevenLabs tags", () => {
    for (let line = 0; line < PREVIEW_ROAST_COUNT; line++) {
      const shown = buildPreviewRoast("Dave", 0.5, line);
      expect(buildPreviewTtsText("Dave", 0.5, line).replace(/\[\w+\] /g, "")).toBe(shown);
    }
  });

  it("treats an out-of-range or non-integer line as the first roast", () => {
    expect(buildPreviewTtsText("Dave", 0.5, 99)).toBe(buildPreviewTtsText("Dave", 0.5, 0));
    expect(buildPreviewTtsText("Dave", 0.5, Number.NaN)).toBe(buildPreviewTtsText("Dave", 0.5, 0));
  });

  it("formats penalties in plain words", () => {
    expect(formatPenalty(0.5)).toBe("50 cents");
    expect(formatPenalty(1)).toBe("1 dollar");
    expect(formatPenalty(2)).toBe("2 dollars");
    expect(formatPenalty(1.5)).toBe("$1.50");
  });

  it("reports unavailable instead of throwing when speech synthesis is missing", async () => {
    await expect(speakRoast("hello")).resolves.toBe("unavailable");
  });

  it("gives up on a hanging /api/tts after 4s and falls back", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = playPreviewAlert("Dave", 0.5, 0);
      await vi.advanceTimersByTimeAsync(4000);
      await expect(result).resolves.toBe("unavailable"); // no speechSynthesis in Node
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ preview: true, username: "Dave", amountDeducted: 0.5, line: 0 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
