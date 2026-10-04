"use client";

import { useCallback, useEffect, useState } from "react";

type Card = { id: string; kicker: string; stat: string; title: string; detail: string };
type Story = { focusType: string; cards: Card[]; narratedBy: "gemini" | "local"; source?: "tiger" | "local" };

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
    const money = story.cards.find((item) => item.id === "money");
    const text = `ScrollStake Wrapped · ${story.focusType}. ${money ? money.title : card.title}`;
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
  return (
    <section className="wrapped" aria-roledescription="carousel" aria-label="Session wrapped">
      <div className="wrapped-progress" aria-hidden="true">
        {story.cards.map((item, itemIndex) => <span key={item.id} className={itemIndex <= index ? "on" : ""} />)}
      </div>
      <div className="wrapped-stage" data-tone={card.id}>
        <span className="eyebrow">{card.kicker}</span>
        <strong className={card.stat.length > 16 ? "wrapped-stat long" : "wrapped-stat"}>{card.stat}</strong>
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
  );
}
