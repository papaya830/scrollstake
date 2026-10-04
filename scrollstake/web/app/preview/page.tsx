"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CameraMonitor from "@/components/CameraMonitor";
import { buildPreviewRoast, playHit, speakRoast, unlockAudio, type SpeechResult } from "@/components/preview-roast";

// Preview-only values. Real rooms take their grace period and penalty from the session.
const START_BALANCE = 20;
const PENALTY = 0.5;
const PREVIEW_GRACE_SECONDS = 10;

type Caught = { roast: string; via: "camera" | "button"; speech: SpeechResult | "speaking" };

/**
 * Standalone "try it" page: no session, wallet, or login. Everything runs in this tab.
 * It must never call the chain, the database, /api/events, or any session route.
 */
export default function PreviewPage() {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState(START_BALANCE);
  const [shown, setShown] = useState(START_BALANCE);
  const [caught, setCaught] = useState<Caught | null>(null);
  const caughtRef = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  // Animate the visible balance toward the real (simulated) one.
  useEffect(() => {
    if (shown === balance) return;
    const step = setTimeout(() => setShown((value) => Math.max(balance, Math.round((value - 0.05) * 100) / 100)), 70);
    return () => clearTimeout(step);
  }, [balance, shown]);

  const getCaught = useCallback((via: Caught["via"]) => {
    if (caughtRef.current) return;
    caughtRef.current = true;
    const roast = buildPreviewRoast(nameRef.current, PENALTY);
    setBalance((value) => Math.round((value - PENALTY) * 100) / 100);
    setCaught({ roast, via, speech: "speaking" });
    playHit();
    void speakRoast(roast).then((speech) => setCaught((current) => current && current.roast === roast ? { ...current, speech } : current));
  }, []);

  const tryAgain = () => {
    window.speechSynthesis?.cancel();
    caughtRef.current = false;
    setCaught(null);
    setBalance(START_BALANCE);
    setShown(START_BALANCE);
  };

  return (
    <>
      <div className="preview-banner" role="status">PREVIEW – no funds at risk</div>
      <main className="shell page">
        <nav className="nav">
          <Link className="brand" href="/"><span className="brand-mark">●</span> ScrollStake</Link>
          <Link className="button" href="/create">Start for real</Link>
        </nav>
        <header className="page-head">
          <div><span className="eyebrow">Free preview</span><h1>Feel the sting.</h1></div>
          <p className="lede">See what happens when you get caught doomscrolling, without staking anything. No wallet, no sign-up, no money.</p>
        </header>
        <div className="session-layout">
          <div style={{ display: "grid", gap: 18 }}>
            <section className="card preview-name">
              <label htmlFor="preview-name">Your name <span className="muted">(optional, for the roast)</span></label>
              <input className="input" id="preview-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Dave" maxLength={30} autoComplete="off" />
            </section>

            <section className="card preview-camera" aria-labelledby="preview-camera-title">
              <span className="eyebrow">Option 1 · Recommended</span>
              <h2 id="preview-camera-title">Get caught by your webcam</h2>
              <ol className="preview-howto">
                <li><strong>Turn on camera</strong> with the button below</li>
                <li><strong>Look at your screen</strong> for 3s while it calibrates</li>
                <li><strong>Look down at your phone</strong> for {PREVIEW_GRACE_SECONDS}s</li>
              </ol>
              <p className="fine">📷 Your camera stays on your device. Face detection runs locally in this tab; no video or images are uploaded.</p>
              {/* Capture-phase click unlocks audio when the user presses "Turn on camera". */}
              <div onClickCapture={unlockAudio}>
                <CameraMonitor graceSeconds={PREVIEW_GRACE_SECONDS} onDistraction={() => getCaught("camera")} />
              </div>
            </section>

            <section className="card preview-simulate">
              <div>
                <span className="eyebrow">Option 2 · No webcam?</span>
                <p className="muted" style={{ margin: "8px 0 0" }}>Skip the detection and jump straight to the consequences.</p>
              </div>
              <button className="button danger" onClick={() => { unlockAudio(); getCaught("button"); }}>Simulate getting caught</button>
            </section>
          </div>
          <aside style={{ display: "grid", gap: 18 }}>
            <section className="card stake-preview">
              <span className="eyebrow">Simulated balance</span>
              <div className="amount">{shown.toFixed(2)}</div>
              <div className="muted">USDC (not real)</div>
              <div className="rule" />
              <div className="member-head"><span>Penalty</span><span>${PENALTY.toFixed(2)}</span></div>
              <div className="member-head" style={{ marginTop: 10 }}><span>Grace period</span><span>{PREVIEW_GRACE_SECONDS}s</span></div>
            </section>
            <section className="card">
              <span className="eyebrow">How it works</span>
              <div className="steps" style={{ marginTop: 20 }}>
                <div className="step">In a real room you stake USDC and study with your group.</div>
                <div className="step">Look down at your phone past the grace period and you lose {PENALTY.toFixed(2)} USDC to the group hangout fund.</div>
                <div className="step">Then you get roasted. Out loud.</div>
              </div>
            </section>
          </aside>
        </div>
      </main>

      {caught && (
        <div className="lockout" role="alertdialog" aria-modal="true" aria-labelledby="lockout-title" aria-describedby="lockout-roast">
          <section className="lockout-card">
            <span className="eyebrow">PREVIEW – no funds at risk</span>
            <h2 id="lockout-title">Caught {caught.via === "camera" ? "looking at your phone" : "doomscrolling"}.</h2>
            <div className="lockout-balance">
              <span className="muted">{START_BALANCE.toFixed(2)} →</span> <strong>{shown.toFixed(2)}</strong> <span className="muted">USDC</span>
            </div>
            <div className="hit" aria-label={`minus ${PENALTY.toFixed(2)} USDC`}>-{PENALTY.toFixed(2)} USDC</div>
            <blockquote id="lockout-roast" className="roast">{caught.roast}</blockquote>
            <p className="fine" aria-live="polite">
              {caught.speech === "speaking" ? "Speaking…" : caught.speech === "spoken" ? "🔊 Roast played aloud." : "Audio isn't available in this browser, so the roast is shown here instead."}
            </p>
            <div className="actions" style={{ justifyContent: "center" }}>
              <Link className="button primary" href="/create">Start for real</Link>
              <button className="button" onClick={tryAgain}>Try again</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
