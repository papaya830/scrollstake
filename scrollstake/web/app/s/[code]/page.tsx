"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ScreenMonitor from "@/components/ScreenMonitor";
import CameraMonitor from "@/components/CameraMonitor";
import SessionAdminPanel from "@/components/SessionAdminPanel";
import { loadAuth, policyKey, type SessionAuth, type SessionView } from "@/components/session-client";

export default function SessionPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  const [session, setSession] = useState<SessionView | null>(null);
  const [auth, setAuth] = useState<SessionAuth | null>(null);
  const [localPolicy, setLocalPolicy] = useState<string[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "Session not found." : "Could not refresh the session.");
      setSession(await response.json() as SessionView);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the session.");
    }
  }, [code]);

  useEffect(() => {
    setAuth(loadAuth(code));
    try {
      const cached = sessionStorage.getItem(policyKey(code));
      setLocalPolicy(cached ? JSON.parse(cached) as string[] : []);
    } catch {
      setLocalPolicy([]);
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [code, refresh]);

  const allowedResources = useMemo(
    () => session?.monitoringPolicy?.allowedResources?.length ? session.monitoringPolicy.allowedResources : localPolicy,
    [localPolicy, session?.monitoringPolicy?.allowedResources],
  );
  const status = session?.status ?? "live"; // Legacy API sessions remain usable until lifecycle endpoints land.
  const scheduledEndReached = Boolean(session?.endsAt && Date.now() >= session.endsAt);

  if (!auth) {
    return (
      <main className="shell page">
        <nav className="nav"><Link className="brand" href="/"><span className="brand-mark">●</span> ScrollStake</Link></nav>
        <section className="card" style={{ maxWidth: 650, margin: "12vh auto", textAlign: "center" }}>
          <span className="eyebrow">Session {code}</span>
          <h1 style={{ fontSize: "3rem", letterSpacing: "-.06em" }}>Join before monitoring.</h1>
          <p className="muted">This tab does not have a client token for the session.</p>
          <Link className="button primary" href={`/join?code=${encodeURIComponent(code)}`}>Join session</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell page">
      <nav className="nav">
        <Link className="brand" href="/"><span className="brand-mark">●</span> ScrollStake</Link>
        <span className="eyebrow">Room {code}</span>
      </nav>
      <header className="page-head">
        <div><span className="eyebrow">{status === "lobby" ? "Session lobby" : status === "ended" || scheduledEndReached ? "Session complete" : "Live study room"}</span><h1>{status === "lobby" ? "Build the room." : status === "ended" || scheduledEndReached ? "Time is up." : "Stay expensive."}</h1></div>
        <div style={{ textAlign: "right" }}><div className="muted">Signed in as</div><strong>{auth.name}</strong></div>
      </header>
      {error && <p className="notice" role="alert">{error}</p>}
      {!session ? (
        <section className="card">Loading session…</section>
      ) : (
        <div className="session-layout">
          <div>
            <SessionAdminPanel session={session} auth={auth} onRefresh={refresh} />
            {status === "lobby" ? null : allowedResources.length > 0 && auth.clientToken ? (
              <>
                <ScreenMonitor
                  code={code}
                  wallet={auth.wallet}
                  clientToken={auth.clientToken}
                  allowedResources={allowedResources}
                  graceSeconds={session.monitoringPolicy?.graceSeconds ?? 10}
                  sampleIntervalSeconds={session.monitoringPolicy?.sampleIntervalSeconds ?? 3}
                  ended={status === "ended" || scheduledEndReached}
                  onEvent={refresh}
                />
                <CameraMonitor
                  code={code}
                  wallet={auth.wallet}
                  clientToken={auth.clientToken}
                  graceSeconds={session.monitoringPolicy?.graceSeconds ?? 10}
                  ended={status === "ended" || scheduledEndReached}
                  onEvent={refresh}
                />
              </>
            ) : (
              <section className="card monitor">
                <div className="monitor-main">
                  <strong>{auth.clientToken ? "Policy pending" : "Approval pending"}</strong>
                  <p>{auth.clientToken ? "The creator&apos;s allowlist is not available from the session API yet. Monitoring stays off so an unknown policy cannot cost you money." : "The creator must approve your request before a monitoring token is issued."}</p>
                  <div className="notice">The lifecycle API must return approved membership and <code>monitoringPolicy.allowedResources</code> before monitoring can start.</div>
                </div>
              </section>
            )}
          </div>
          <aside style={{ display: "grid", gap: 18 }}>
            <section className="card">
              <span className="eyebrow">Approved resources</span>
              <div className="policy-list">
                {allowedResources.length ? allowedResources.map((resource) => <div className="policy-chip" key={resource}>{resource}</div>) : <p className="muted">No policy received.</p>}
              </div>
            </section>
            <section className="card">
              <span className="eyebrow">Group</span>
              <div className="member-list">
                {session.members.map((member) => (
                  <div className="member" key={member.wallet}>
                    <div className="member-head"><span>{member.name}</span><span>{"♥".repeat(member.livesLeft) || "—"}</span></div>
                    <div className="member-stats"><span>{member.strikes} strikes</span><span>${member.slashedUsdc.toFixed(2)} slashed</span></div>
                  </div>
                ))}
              </div>
              <div className="rule" />
              <div className="member-head"><span>Your stake</span><span>${session.stakeUsdc.toFixed(2)}</span></div>
              <div className="member-head" style={{ marginTop: 10 }}><span>Penalty</span><span>${session.penaltyUsdc.toFixed(2)}</span></div>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
