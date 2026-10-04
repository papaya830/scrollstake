import { describe, expect, it } from "vitest";
import type { Session } from "./types";
import type { WrappedEvent } from "./session-events";
import { eventsFromPulse } from "./session-events";
import { applyCaptions, buildBoard, buildWrapped } from "./wrapped";

const start = Date.parse("2026-10-04T15:00:00Z");

function session(members: Session["members"]): Session {
  return {
    code: "ROOM1",
    creatorWallet: "camille",
    stakeUsdc: 10,
    penaltyUsdc: 0.5,
    lives: 1,
    createdAt: start,
    members,
    status: "ended",
    durationMinutes: 25,
    startsAt: start,
    endsAt: start + 25 * 60_000,
    endedAt: start + 25 * 60_000,
    monitoringPolicy: { allowedResources: [], graceSeconds: 10, sampleIntervalSeconds: 3 },
  };
}

function member(wallet: string, name: string, strikes: number, slashedUsdc: number): Session["members"][number] {
  return { wallet, name, livesLeft: strikes ? 0 : 1, strikes, slashedUsdc, lastEventAt: 0, membershipStatus: "approved" };
}

describe("session wrapped", () => {
  it("calls a clean player The Monk and keeps their stake", () => {
    const story = buildWrapped(session([member("camille", "Camille", 0, 0)]), [], "camille");
    expect(story.focusType).toBe("The Monk");
    expect(story.cards.find((card) => card.id === "money")).toMatchObject({ stat: "$0.00", title: "You kept the whole stake." });
    expect(story.cards.find((card) => card.id === "locked")?.stat).toBe("25 min");
    expect(story.cards.find((card) => card.id === "clean")?.stat).toBe("1 of 1");
    expect(story.cards.some((card) => card.id === "crack")).toBe(false);
  });

  it("finds the weakest minute, the flake, and the hang-out fund", () => {
    const events: WrappedEvent[] = [
      { wallet: "alex", kind: "heartbeat", at: start + 30_000 },
      { wallet: "alex", kind: "forgiven", at: start + 3 * 60_000 },
      { wallet: "alex", kind: "slashed", at: start + 3 * 60_000 + 20_000, penaltyUsdc: 0.5 },
      { wallet: "alex", kind: "slashed", at: start + 4 * 60_000, penaltyUsdc: 0.5 },
      { wallet: "camille", kind: "heartbeat", at: start + 60_000 },
      { wallet: "camille", kind: "heartbeat", at: start + 75_000 },
      { wallet: "camille", kind: "heartbeat", at: start + 90_000 },
    ];
    const story = buildWrapped(session([
      member("camille", "Camille", 0, 0),
      member("alex", "Alex", 2, 1),
    ]), events, "alex");
    expect(story.focusType).toBe("The Doomscroller");
    expect(story.cards.find((card) => card.id === "crack")).toMatchObject({ stat: "min 4" });
    expect(story.cards.find((card) => card.id === "money")?.stat).toBe("$1.00");
    expect(story.cards.find((card) => card.id === "money")?.detail).toContain("group jar");
    expect(story.cards.find((card) => card.id === "awards")?.detail).toContain("Most Focused · Camille");
    expect(story.cards.find((card) => card.id === "awards")?.detail).toContain("Biggest Flake · Alex ($1.00 into the jar)");
    expect(story.cards.find((card) => card.id === "group")?.detail).toContain("collected $1.00");
    expect(story.cards.find((card) => card.id === "clean")?.stat).toBe("1 of 2");
  });

  it("names a late slip and a comeback from the timestamps", () => {
    const late: WrappedEvent[] = [
      { wallet: "sam", kind: "heartbeat", at: start + 60_000 },
      { wallet: "sam", kind: "slashed", at: start + 22 * 60_000, penaltyUsdc: 0.5 },
    ];
    expect(buildWrapped(session([member("sam", "Sam", 1, 0.5)]), late, "sam").focusType).toBe("The 11th-Hour Crammer");

    const rebound: WrappedEvent[] = [
      { wallet: "sam", kind: "slashed", at: start + 2 * 60_000, penaltyUsdc: 0.5 },
      { wallet: "sam", kind: "heartbeat", at: start + 5 * 60_000 },
      { wallet: "sam", kind: "heartbeat", at: start + 5 * 60_000 + 15_000 },
      { wallet: "sam", kind: "heartbeat", at: start + 5 * 60_000 + 30_000 },
    ];
    const story = buildWrapped(session([member("sam", "Sam", 1, 0.5)]), rebound, "sam");
    expect(story.focusType).toBe("The Comeback");
    expect(story.cards.find((card) => card.id === "awards")?.detail).toContain("Comeback Kid · Sam");
  });

  it("rebuilds a timeline from Tiger focus-pulse buckets", () => {
    const events = eventsFromPulse([{
      bucket: "2026-10-04T15:00:00.000Z",
      wallet: "alex",
      name: "Alex",
      focusedSamples: 2,
      forgiven: 1,
      slashes: 1,
      penaltyUsdc: 0.5,
    }]);
    expect(events.map((event) => event.kind)).toEqual(["heartbeat", "forgiven", "slashed", "heartbeat"]);
    const story = buildWrapped(session([member("alex", "Alex", 1, 0.5)]), events, "alex");
    expect(story.cards.find((card) => card.id === "money")?.stat).toBe("$0.50");
    expect(story.cards.find((card) => card.id === "locked")?.stat).toBe("30 sec");
  });

  it("lets Gemini rewrite the line and keeps the measured stat", () => {
    const story = buildWrapped(session([member("camille", "Camille", 0, 0)]), [], "camille");
    const next = applyCaptions(story.cards, {
      money: { title: "Your phone got nothing.", detail: "A sentence that is still about the stake." },
      locked: { title: "x".repeat(400) },
    });
    expect(next.find((card) => card.id === "money")).toMatchObject({ stat: "$0.00", title: "Your phone got nothing." });
    expect(next.find((card) => card.id === "locked")?.title).toBe(story.cards.find((card) => card.id === "locked")?.title);
    expect(next.find((card) => card.id === "locked")?.stat).toBe("25 min");
  });

  it("ranks the most locked out member first and names them on a card", () => {
    const room = session([member("camille", "Camille", 0, 0), member("theo", "Theo", 2, 1)]);
    const events: WrappedEvent[] = [
      { wallet: "theo", kind: "forgiven", at: start + 60_000 },
      { wallet: "theo", kind: "slashed", at: start + 120_000, penaltyUsdc: 0.5 },
      { wallet: "theo", kind: "slashed", at: start + 180_000, penaltyUsdc: 0.5 },
      { wallet: "camille", kind: "heartbeat", at: start + 60_000 },
    ];
    const board = buildBoard(room, events);
    expect(board.map((row) => row.name)).toEqual(["Theo", "Camille"]);
    expect(board[0]).toMatchObject({ slips: 3, forgiven: 1, slashes: 2, lostUsdc: 1 });
    const card = buildWrapped(room, events, "camille").cards.find((item) => item.id === "lockedout");
    expect(card).toMatchObject({ stat: "Theo", wallet: "theo" });
  });
});
