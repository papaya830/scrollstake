"use client";

import { useCallback, useEffect, useState } from "react";

type Card = { id: string; kicker: string; stat: string; title: string; detail: string; wallet?: string };
type BoardRow = { wallet: string; name: string; focusMinutes: number; slips: number; forgiven: number; slashes: number; lostUsdc: number };
type Snapshot = { wallet: string; name?: string; kind: "forgiven" | "slashed"; reason?: string; at: number; camera?: string; screen?: string };
type Story = {
  focusType: string;
  cards: Card[];
  narratedBy: "gemini" | "local";
  source?: "tiger" | "local";
  board?: BoardRow[];
  jarUsdc?: number;
  snapshots?: Snapshot[];
};
type Metric = "slips" | "lostUsdc" | "focusMinutes";

const METRICS: { id: Metric; label: string; format: (value: number) => string }[] = [
  { id: "slips", label: "Times caught", format: (value) => String(value) },
  { id: "lostUsdc", label: "$ into jar", format: (value) => `$${value.toFixed(2)}` },
  { id: "focusMinutes", label: "Focus min", format: (value) => `${Math.round(value * 10) / 10}` },
];

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function reasonLabel(reason?: string) {
  if (!reason) return "Distracted";
  const parts = reason.split(/[:+]/).filter(Boolean);
  const label = (parts[parts.length - 1] ?? reason).replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function StatsChart({ board }: { board: BoardRow[] }) {
  const [metric, setMetric] = useState<Metric>("slips");
  const spec = METRICS.find((item) => item.id === metric)!;
  const max = Math.max(...board.map((row) => row[metric]), 0);
  const rows = [...board].sort((a, b) => b[metric] - a[metric]);
  return (
    <div className="wrapped-chart">
      <div className="wrapped-tabs" role="tablist" aria-label="Chart metric">
        {METRICS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === metric} className={item.id === metric ? "on" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.wallet} className="wrapped-bar">
          <span className="wrapped-bar-name">{row.name}</span>
          <span className="wrapped-bar-track"><span className={`wrapped-bar-fill ${metric}`} style={{ width: `${max > 0 && row[metric] > 0 ? Math.max(2, (row[metric] / max) * 100) : 0}%` }} /></span>
          <span className="wrapped-bar-value">{spec.format(row[metric])}</span>
        </div>
      ))}
    </div>
  );
}

export default function SessionWrapped({ code, wallet }: { code: string; wallet: string }) {
  const [story, setStory] = useState<Story | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(code)}/wrapped?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
        const body = await response.json() as Story & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Wrapped is not ready.");
        if (!cancelled) setStory(body);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Wrapped is not ready.");
      }
    })();
    return () => { cancelled = true; };
  }, [code, wallet]);

  const count = story?.cards.length ?? 0;
  const step = useCallback((direction: number) => {
    setIndex((current) => {
      if (!count) return 0;
      return (current + direction + count) % count;
    });
  }, [count]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  async function copyRecap() {
    if (!story) return;
    const card = story.cards.find((item) => item.id === "type") ?? story.cards[0];
    const lost = story.cards.find((item) => item.id === "money");
    const worst = story.board?.[0];
    const text = `ScrollStake Wrapped · ${story.focusType}. ${lost ? lost.title : card.title}${worst && worst.slips > 0 ? ` Most locked out: ${worst.name} (${worst.slips}x).` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (error) return <section className="card"><span className="eyebrow">Wrapped</span><p className="muted">{error}</p></section>;
  if (!story) return <section className="card wrapped"><span className="eyebrow">Wrapped</span><h2>Counting the session…</h2></section>;

  const card = story.cards[index];
  const board = story.board ?? [];
  const snapshots = story.snapshots ?? [];
  const cardPhoto = card.wallet ? snapshots.find((shot) => shot.wallet === card.wallet && shot.camera) : undefined;
  const jar = story.jarUsdc ?? board.reduce((sum, row) => sum + row.lostUsdc, 0);

  return (
    <>
      <section className="wrapped" aria-roledescription="carousel" aria-label="Session wrapped">
        <div className="wrapped-progress" aria-hidden="true">
          {story.cards.map((item, itemIndex) => <span key={item.id} className={itemIndex <= index ? "on" : ""} />)}
        </div>
        <div className="wrapped-stage" data-tone={card.id}>
          <span className="eyebrow">{card.kicker}</span>
          <strong className={card.stat.length > 16 ? "wrapped-stat long" : "wrapped-stat"}>{card.stat}</strong>
          {cardPhoto?.camera && <img className="wrapped-mugshot" src={cardPhoto.camera} alt={`${card.stat} caught on camera`} />}
          <h2>{card.title}</h2>
          <p>{card.detail}</p>
        </div>
        <div className="wrapped-nav">
          <button className="button" type="button" onClick={() => step(-1)}>Back</button>
          <span className="fine">{index + 1} / {count}{story.source === "tiger" ? " · Tiger Data" : ""}{story.narratedBy === "gemini" ? " · Gemini" : ""}</span>
          <button className="button primary" type="button" onClick={() => step(1)}>Next</button>
        </div>
        <button className="button wrapped-share" type="button" onClick={() => void copyRecap()}>{copied ? "Copied" : "Copy recap"}</button>
      </section>

      {board.length > 0 && (
        <section className="card wrapped-panel">
          <span className="eyebrow">Room stats</span>
          <h2>Who got locked out the most</h2>
          <StatsChart board={board} />
          <div className="wrapped-money">
            {board.map((row, rowIndex) => (
              <div key={row.wallet} className="wrapped-money-row">
                <span>{rowIndex === 0 && row.slips > 0 ? "👑 " : ""}{row.name}</span>
                <span className="muted">{row.slips} caught · {row.forgiven} free {row.forgiven === 1 ? "pass" : "passes"} · {row.slashes} slashed</span>
                <strong className={row.lostUsdc > 0 ? "lost" : ""}>{row.lostUsdc > 0 ? `-${money(row.lostUsdc)}` : money(0)}</strong>
              </div>
            ))}
            <div className="wrapped-money-row total">
              <span>Hang-out jar</span>
              <span className="muted">Every slash goes here</span>
              <strong>{money(jar)}</strong>
            </div>
          </div>
        </section>
      )}

      <section className="card wrapped-panel">
        <span className="eyebrow">Caught in 4K</span>
        <h2>The receipts</h2>
        {snapshots.length === 0 ? (
          <p className="muted">No photos this session. Either everyone stayed locked in or nobody shared a camera.</p>
        ) : (
          <div className="wrapped-gallery">
            {snapshots.map((shot, shotIndex) => (
              <figure key={`${shot.wallet}-${shot.at}-${shotIndex}`} className={`wrapped-shot ${shot.kind}`}>
                <div className="wrapped-shot-images">
                  {shot.camera && <img src={shot.camera} alt={`${shot.name ?? "Member"} on camera when caught`} />}
                  {shot.screen && <img src={shot.screen} alt={`${shot.name ?? "Member"}'s screen when caught`} />}
                </div>
                <figcaption>
                  <strong>{shot.name ?? "Member"}</strong>
                  <span>{reasonLabel(shot.reason)} · {new Date(shot.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  <em>{shot.kind === "slashed" ? "Slashed" : "Free pass"}</em>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
