import { describe, expect, it } from "vitest";
import { buildPreviewRoast, formatPenalty, speakRoast } from "./preview-roast";

describe("preview roast", () => {
  it("prefixes every roast as a test and names the user", () => {
    expect(buildPreviewRoast("Dave", 0.5, 0)).toMatch(/^This is a test, but Dave would've just lost 50 cents\. \S/);
  });

  it("falls back to 'you' when no name is given", () => {
    expect(buildPreviewRoast("   ", 0.5, 0.99)).toMatch(/^This is a test, but you would've just lost 50 cents\./);
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
});
