import type { Session } from "./types";
import type { WrappedEvent } from "./session-events";

export type WrappedCard = {
  id: string;
  kicker: string;
  stat: string;
  title: string;
  detail: string;
  wallet?: string;
};

export type BoardRow = {
  wallet: string;
  name: string;
  focusMinutes: number;
  slips: number;
  forgiven: number;
  slashes: number;
  lostUsdc: number;
};

export type WrappedStory = {
  focusType: string;
  cards: WrappedCard[];
};

const HEARTBEAT_MS = 15_000;
const FOCUS_TYPES = ["The Monk", "The Close Call", "The Doomscroller", "The 11th-Hour Crammer", "The Comeback"] as const;

type Person = {
  wallet: string;
  name: string;
  slashedUsdc: number;
  strikes: number;
  events: WrappedEvent[];
};

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function formatMinutes(minutes: number) {
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return Number.isInteger(hours) ? `${hours} hr` : `${hours} hr`;
  }
  if (minutes > 0 && minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  const rounded = Math.round(minutes * 10) / 10;
  return `${rounded} min`;
}

function elapsedMinutes(session: Session) {
  const end = session.endedAt ?? session.endsAt;
  if (session.startsAt && end && end > session.startsAt) return Math.max(1, Math.round((end - session.startsAt) / 60_000));
  return Math.max(1, session.durationMinutes || 1);
}

function focusedMinutes(person: Person, elapsed: number) {
  const beats = person.events.filter((event) => event.kind === "heartbeat");
  if (beats.length) return Math.round(((beats.length * HEARTBEAT_MS) / 60_000) * 10) / 10;
  if (person.strikes === 0 && person.events.every((event) => event.kind === "heartbeat")) return elapsed;
  return 0;
}

function longestStreakMinutes(person: Person, elapsed: number) {
  const beats = person.events.filter((event) => event.kind === "heartbeat").sort((a, b) => a.at - b.at);
  if (!beats.length) return person.strikes === 0 ? elapsed : 0;
  let best = HEARTBEAT_MS;
  let runStart = beats[0].at;
  let previous = beats[0].at;
  for (const beat of beats.slice(1)) {
    if (beat.at - previous > HEARTBEAT_MS + 10_000) {
      best = Math.max(best, previous - runStart + HEARTBEAT_MS);
      runStart = beat.at;
    }
    previous = beat.at;
  }
  best = Math.max(best, previous - runStart + HEARTBEAT_MS);
  return Math.round((best / 60_000) * 10) / 10;
}

function weakestMinute(person: Person, startsAt?: number) {
  const slips = person.events.filter((event) => event.kind !== "heartbeat");
  if (!slips.length || !startsAt) return null;
  const counts = new Map<number, number>();
  for (const slip of slips) {
    const minute = Math.max(1, Math.floor((slip.at - startsAt) / 60_000) + 1);
    counts.set(minute, (counts.get(minute) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function lateHeavy(person: Person, startsAt: number | undefined, elapsed: number) {
  const slips = person.events.filter((event) => event.kind !== "heartbeat");
  if (!slips.length || !startsAt) return false;
  const cutoff = startsAt + elapsed * 60_000 * 0.8;
  return slips.filter((slip) => slip.at >= cutoff).length * 2 >= slips.length;
}

function cameBack(person: Person) {
  const slips = person.events.filter((event) => event.kind !== "heartbeat");
  if (!slips.length) return false;
  const last = Math.max(...slips.map((slip) => slip.at));
  const before = person.events.filter((event) => event.kind === "heartbeat" && event.at <= last).length;
  const after = person.events.filter((event) => event.kind === "heartbeat" && event.at > last).length;
  return after > 0 && after >= before;
}

function focusType(person: Person, startsAt: number | undefined, elapsed: number) {
  if (person.strikes > 0 && lateHeavy(person, startsAt, elapsed)) return "The 11th-Hour Crammer";
  if (person.strikes > 0 && cameBack(person)) return "The Comeback";
  if (person.strikes > 0) return "The Doomscroller";
  if (person.events.some((event) => event.kind === "forgiven")) return "The Close Call";
  return "The Monk";
}

function people(session: Session, events: WrappedEvent[]): Person[] {
  return session.members
    .filter((member) => member.membershipStatus === "approved")
    .map((member) => ({
      wallet: member.wallet,
      name: member.name,
      slashedUsdc: member.slashedUsdc,
      strikes: member.strikes,
      events: events.filter((event) => event.wallet === member.wallet),
    }));
}

function slipCount(person: Person) {
  return Math.max(person.events.filter((event) => event.kind !== "heartbeat").length, person.strikes);
}

/** Everyone in the room, most locked out first. */
export function buildBoard(session: Session, events: WrappedEvent[]): BoardRow[] {
  const elapsed = elapsedMinutes(session);
  return people(session, events)
    .map((person) => ({
      wallet: person.wallet,
      name: person.name,
      focusMinutes: focusedMinutes(person, elapsed),
      slips: slipCount(person),
      forgiven: person.events.filter((event) => event.kind === "forgiven").length,
      slashes: person.strikes,
      lostUsdc: person.slashedUsdc,
    }))
    .sort((a, b) => b.slips - a.slips || b.lostUsdc - a.lostUsdc || a.focusMinutes - b.focusMinutes);
}

export function buildWrapped(session: Session, events: WrappedEvent[], viewerWallet: string): WrappedStory {
  const roster = people(session, events);
  const elapsed = elapsedMinutes(session);
  const viewer = roster.find((person) => person.wallet === viewerWallet) ?? roster[0];
  const name = viewer?.name ?? "You";
  const type = viewer ? focusType(viewer, session.startsAt, elapsed) : "The Monk";
  const viewerFocus = viewer ? focusedMinutes(viewer, elapsed) : 0;
  const viewerStreak = viewer ? longestStreakMinutes(viewer, elapsed) : 0;
  const viewerMoney = viewer?.slashedUsdc ?? 0;
  const crack = viewer ? weakestMinute(viewer, session.startsAt) : null;
  const clean = roster.filter((person) => person.strikes === 0);
  const groupFocus = roster.reduce((sum, person) => sum + focusedMinutes(person, elapsed), 0);
  const groupMoney = roster.reduce((sum, person) => sum + person.slashedUsdc, 0);
  const ranked = [...roster].sort((a, b) => focusedMinutes(b, elapsed) - focusedMinutes(a, elapsed) || a.slashedUsdc - b.slashedUsdc);
  const flake = [...roster].sort((a, b) => b.slashedUsdc - a.slashedUsdc)[0];
  const comeback = [...roster].filter(cameBack).sort((a, b) => {
    const after = (person: Person) => person.events.filter((event) => event.kind === "heartbeat" && event.at > Math.max(...person.events.filter((item) => item.kind !== "heartbeat").map((item) => item.at))).length;
    return after(b) - after(a);
  })[0];

  const cards: WrappedCard[] = [
    {
      id: "intro",
      kicker: "Session wrapped",
      stat: session.code,
      title: `${name}, this room is closed.`,
      detail: `A ${elapsed} min study session. Stake was ${money(session.stakeUsdc)}. A slip costs ${money(session.penaltyUsdc)}.`,
    },
    {
      id: "locked",
      kicker: "Time locked in",
      stat: formatMinutes(viewerFocus),
      title: viewerFocus > 0 ? "You stayed with the work." : "Focus time did not get measured.",
      detail: viewerStreak > 0 ? `Longest stretch without a phone grab: ${formatMinutes(viewerStreak)}.` : "Share your screen next time and the timer can count a real streak.",
    },
    {
      id: "money",
      kicker: "Money lost",
      stat: money(viewerMoney),
      title: viewerMoney > 0 ? `You donated ${money(viewerMoney)} to your phone.` : "You kept the whole stake.",
      detail: viewerMoney > 0 ? "That money stays in the group jar. It does not land in another friend's wallet." : "No slash this session. The hang-out fund got nothing from you.",
    },
  ];

  if (crack) {
    cards.push({
      id: "crack",
      kicker: "Weakest minute",
      stat: `min ${crack}`,
      title: `You reached for your phone around minute ${crack}.`,
      detail: "That minute collected more slips than any other.",
    });
  }

  cards.push({
    id: "clean",
    kicker: "Clean sessions",
    stat: `${clean.length} of ${roster.length || 1}`,
    title: clean.length === roster.length && roster.length > 0 ? "Nobody paid the phone." : clean.length === 0 ? "Everybody slipped." : `${clean.length} ${clean.length === 1 ? "person" : "people"} got through with zero slashes.`,
    detail: clean.length ? clean.map((person) => person.name).join(", ") + (clean.length === 1 ? " kept every dollar." : " kept every dollar.") : "Every approved member took at least one slash.",
  });

  const lockedOut = [...roster].sort((a, b) => slipCount(b) - slipCount(a) || b.slashedUsdc - a.slashedUsdc)[0];
  if (lockedOut && slipCount(lockedOut) > 0) {
    const slips = slipCount(lockedOut);
    cards.push({
      id: "lockedout",
      kicker: "Most locked out",
      stat: lockedOut.name,
      title: `${lockedOut.name} got caught ${slips} ${slips === 1 ? "time" : "times"}.`,
      detail: lockedOut.slashedUsdc > 0 ? `${money(lockedOut.slashedUsdc)} went into the jar. The camera kept the receipts.` : "Free passes covered it. The camera still kept the receipts.",
      wallet: lockedOut.wallet,
    });
  }

  const awardLines = [
    ranked[0] ? `Most Focused · ${ranked[0].name}` : "",
    flake && flake.slashedUsdc > 0 ? `Biggest Flake · ${flake.name} (${money(flake.slashedUsdc)} into the jar)` : "",
    comeback ? `Comeback Kid · ${comeback.name}` : "",
  ].filter(Boolean);
  cards.push({
    id: "awards",
    kicker: "The room",
    stat: ranked[0]?.name ?? "—",
    title: "Leaderboard awards",
    detail: awardLines.join("  ·  ") || "Not enough of a session to hand out titles.",
  });

  cards.push({
    id: "group",
    kicker: "Together",
    stat: formatMinutes(groupFocus),
    title: groupFocus > 0 ? `Your group stayed focused for ${formatMinutes(groupFocus)}.` : "The group clock ran. Focus samples did not.",
    detail: groupMoney > 0 ? `The hang-out fund collected ${money(groupMoney)} from phone habits.` : "The hang-out fund collected nothing. Clean room.",
  });

  cards.push({
    id: "type",
    kicker: "Your focus type",
    stat: type,
    title: type,
    detail: type === "The Monk"
      ? "No free passes. No slashes. You just worked."
      : type === "The Close Call"
        ? "You used a free pass and still kept the stake."
        : type === "The Comeback"
          ? "You slipped, then locked back in harder than you started."
          : type === "The 11th-Hour Crammer"
            ? "The phone showed up late, when the timer was almost done."
            : "The phone won a few rounds. The jar kept the change.",
  });

  return { focusType: type, cards };
}

export function cleanLine(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 180) return undefined;
  return text;
}

export function applyCaptions(cards: WrappedCard[], captions: Record<string, { title?: unknown; detail?: unknown }> | undefined) {
  if (!captions) return cards;
  return cards.map((card) => {
    const next = captions[card.id];
    if (!next) return card;
    return { ...card, title: cleanLine(next.title) ?? card.title, detail: cleanLine(next.detail) ?? card.detail };
  });
}

export function isFocusType(value: string) {
  return (FOCUS_TYPES as readonly string[]).includes(value);
}
