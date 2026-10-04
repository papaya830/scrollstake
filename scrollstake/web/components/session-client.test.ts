import { describe, expect, it } from "vitest";
import { formatTimeRemaining } from "./session-client";

describe("formatTimeRemaining", () => {
  it("formats active and expired session timers", () => {
    expect(formatTimeRemaining(125_000, 0)).toBe("2:05");
    expect(formatTimeRemaining(0, 1)).toBe("0:00");
    expect(formatTimeRemaining(undefined, 1)).toBeNull();
  });
});
