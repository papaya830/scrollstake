"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseResources, policyKey, storeAuth } from "@/components/session-client";

const STARTER_RESOURCES = "canvas.ubc.ca\ndocs.google.com\nnotion.so\nVS Code\nCourse lecture slides";

export default function CreateSessionPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const wallet = String(data.get("wallet") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const allowedResources = parseResources(String(data.get("resources") ?? ""));

    try {
      if (!wallet || !name || allowedResources.length === 0) throw new Error("Add your identity and at least one approved study resource.");
      const created = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creatorWallet: wallet,
          stakeUsdc: Number(data.get("stake")),
          penaltyUsdc: Number(data.get("penalty")),
          lives: Number(data.get("lives")),
          allowedResources,
        }),
      });
      if (!created.ok) throw new Error("Could not create the session.");
      const { code } = await created.json() as { code: string };
      const joined = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, wallet, name }),
      });
      if (!joined.ok) throw new Error("Session created, but the creator could not join.");
      const result = await joined.json() as { clientToken: string };
      storeAuth(code, { wallet, name, clientToken: result.clientToken });
      sessionStorage.setItem(policyKey(code), JSON.stringify(allowedResources));
      router.push(`/s/${code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="shell page">
      <nav className="nav">
        <Link className="brand" href="/"><span className="brand-mark">●</span> ScrollStake</Link>
        <Link className="button" href="/join">Join instead</Link>
      </nav>
      <header className="page-head">
        <div><span className="eyebrow">New focus room</span><h1>Set the stakes.</h1></div>
        <p className="lede">You choose what counts as studying. Everything else has to survive the grace period.</p>
      </header>
      <form className="grid" onSubmit={submit}>
        <section className="card form-card">
          <div className="field-row">
            <div className="field"><label htmlFor="name">Display name</label><input className="input" id="name" name="name" required placeholder="Camille" /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="wallet">Solana wallet</label><input className="input" id="wallet" name="wallet" required placeholder="Wallet public key" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label htmlFor="stake">Stake (USDC)</label><input className="input" id="stake" name="stake" type="number" min="1" step="0.5" defaultValue="10" required /></div>
            <div className="field"><label htmlFor="penalty">Penalty</label><input className="input" id="penalty" name="penalty" type="number" min="0.1" step="0.1" defaultValue="0.5" required /></div>
            <div className="field"><label htmlFor="lives">Free passes</label><input className="input" id="lives" name="lives" type="number" min="0" max="10" defaultValue="2" required /></div>
          </div>
          <div className="field">
            <label htmlFor="resources">Approved study resources</label>
            <textarea className="input" id="resources" name="resources" defaultValue={STARTER_RESOURCES} required />
            <span className="fine">One domain, app, or recognizable course resource per line. Specific entries reduce false positives.</span>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create session"}</button>
        </section>
        <aside className="card aside-card">
          <span className="eyebrow">How monitoring works</span>
          <div className="steps" style={{ marginTop: 24 }}>
            <div className="step">Everyone shares their entire screen. The stream stays on their device.</div>
            <div className="step">Text is checked locally against your approved-resource policy.</div>
            <div className="step">A confirmed distraction gets a 10-second chance to disappear before an event is sent.</div>
          </div>
          <div className="notice" style={{ marginTop: 26 }}>Only one compressed frame from an emitted violation is eligible for evidence storage. Routine frames are discarded.</div>
        </aside>
      </form>
    </main>
  );
}
