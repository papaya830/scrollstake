import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authMember,
  createSession,
  endSession,
  expireSessionIfDue,
  getSession,
  issueApprovedToken,
  joinSession,
  markDeposit,
  recordForgiven,
  recordSlash,
  resetMemoryStoreForTests,
  startSession,
  updateMembership,
} from "./store";

const creator = "Creator1111111111111111111111111111111111";
const member = "Member11111111111111111111111111111111111";
const outsider = "Outsider111111111111111111111111111111111";

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetMemoryStoreForTests();
});

afterEach(() => resetMemoryStoreForTests());

describe("deployment persistence guard", () => {
  it("does not create an isolated in-memory room on Vercel without Postgres", async () => {
    const originalVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await expect(createSession({ creatorWallet: creator, stakeUsdc: 5, penaltyUsdc: 0.5, lives: 2 })).rejects.toThrow("Shared sessions need DATABASE_URL");
    } finally {
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
    }
  });
});

describe("two-participant session lifecycle", () => {
  it("keeps creator and member state synchronized while enforcing permissions", async () => {
    const created = await createSession({ creatorWallet: creator, stakeUsdc: 10, penaltyUsdc: 0.5, lives: 1, durationMinutes: 25, allowedResources: ["Canvas", "GitHub"] });
    expect(created.status).toBe("lobby");
    expect(created.monitoringPolicy.allowedResources).toEqual(["Canvas", "GitHub"]);

    const camille = await joinSession(created.code, creator, "Camille");
    const alex = await joinSession(created.code, member, "Alex");
    expect(camille?.membershipStatus).toBe("approved");
    expect(camille?.clientToken).toBeTruthy();
    expect(alex?.membershipStatus).toBe("pending");
    expect(alex?.clientToken).toBeUndefined();

    expect(await updateMembership(created.code, outsider, member, "approve")).toBeUndefined();
    const approved = await updateMembership(created.code, creator, member, "approve");
    expect(approved?.members.find((item) => item.wallet === member)?.membershipStatus).toBe("approved");
    const alexToken = await issueApprovedToken(created.code, member);
    expect(alexToken).toBeTruthy();

    expect(await startSession(created.code, creator)).toBeUndefined();
    await markDeposit(created.code, creator, "DRYRUN_creator");
    await markDeposit(created.code, member, "DRYRUN_member");
    const live = await startSession(created.code, creator);
    expect(live).toMatchObject({ status: "live", durationMinutes: 25 });
    expect(live?.startsAt).toBeTypeOf("number");
    expect(live?.endsAt).toBeGreaterThan(live?.startsAt ?? Infinity);

    expect(await updateMembership(created.code, creator, member, "remove")).toBeUndefined();
    const authorized = await authMember(created.code, member, alexToken ?? null);
    expect(authorized?.member.name).toBe("Alex");
    expect(await authMember(created.code, creator, alexToken ?? null)).toBeUndefined();

    await recordForgiven(created.code, member, Date.now());
    await recordSlash(created.code, member, Date.now() + 6_000, 0.5);
    const afterEvent = await getSession(created.code);
    const alexState = afterEvent?.members.find((item) => item.wallet === member);
    expect(alexState).toMatchObject({ livesLeft: 0, strikes: 1, slashedUsdc: 0.5 });

    const ended = await endSession(created.code, creator, "demo complete");
    expect(ended).toMatchObject({ status: "ended", endReason: "demo complete" });
    expect(await endSession(created.code, creator)).toBeUndefined();
  });

  it("never leaks members or policies between rooms", async () => {
    const first = await createSession({ creatorWallet: creator, stakeUsdc: 5, penaltyUsdc: 0.5, lives: 2, allowedResources: ["Course A"] });
    const second = await createSession({ creatorWallet: outsider, stakeUsdc: 5, penaltyUsdc: 0.5, lives: 2, allowedResources: ["Course B"] });
    await joinSession(first.code, creator, "Camille");
    await joinSession(first.code, member, "Alex");
    const isolated = await getSession(second.code);
    expect(isolated?.members).toEqual([]);
    expect(isolated?.monitoringPolicy.allowedResources).toEqual(["Course B"]);
  });

  it("automatically completes a room when its scheduled end is reached", async () => {
    const created = await createSession({ creatorWallet: creator, stakeUsdc: 5, penaltyUsdc: 0.5, lives: 1, durationMinutes: 25 });
    await joinSession(created.code, creator, "Camille");
    await markDeposit(created.code, creator, "DRYRUN_creator");
    const live = await startSession(created.code, creator);
    const ended = await expireSessionIfDue(created.code, (live?.endsAt ?? 0) + 1);
    expect(ended).toMatchObject({ status: "ended", endReason: "Scheduled timer complete" });
  });
});
