"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { storeAuth } from "@/components/session-client";

function JoinSessionForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").trim().toUpperCase();
    const wallet = String(data.get("wallet") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    try {
      const response = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, wallet, name }),
      });
      const result = await response.json() as { clientToken?: string; membershipStatus?: "pending" | "approved"; error?: string; status?: string };
      if (result.status === "ended") {
        router.push(`/s/${code}`);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "Could not join that session.");
      storeAuth(code, { wallet, name, clientToken: result.clientToken, membershipStatus: result.membershipStatus ?? (result.clientToken ? "approved" : "pending") });
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
        <Link className="button" href="/create">Create instead</Link>
      </nav>
      <header className="page-head">
        <div><span className="eyebrow">Enter the room</span><h1>Lock in.</h1></div>
        <p className="lede">The creator approves lobby requests before a member can fund a stake or receive a monitoring token.</p>
      </header>
      <form className="grid" onSubmit={submit}>
        <section className="card form-card">
          <div className="field"><label htmlFor="code">Session code</label><input className="input" id="code" name="code" defaultValue={search.get("code") ?? ""} maxLength={6} required placeholder="AB12CD" style={{ textTransform: "uppercase", letterSpacing: ".16em" }} /></div>
          <div className="field"><label htmlFor="name">Display name</label><input className="input" id="name" name="name" required placeholder="Camille" /></div>
          <div className="field"><label htmlFor="wallet">Solana wallet</label><input className="input" id="wallet" name="wallet" required placeholder="Wallet public key" /></div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>{busy ? "Joining…" : "Join session"}</button>
        </section>
        <aside className="card aside-card">
          <span className="eyebrow">Before you join</span>
          <h2>Screen sharing is visible and voluntary.</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>Monitoring begins only after you click Start and select an entire screen. You can stop at any time, but a stopped share enters the same grace period as a distraction.</p>
        </aside>
      </form>
    </main>
  );
}

export default function JoinSessionPage() {
  return (
    <Suspense fallback={<main className="shell page"><section className="card">Loading join form…</section></main>}>
      <JoinSessionForm />
    </Suspense>
  );
}
