"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import FocusMonitor from "@/components/FocusMonitor";
import FocusPulse from "@/components/FocusPulse";
import SessionAdminPanel from "@/components/SessionAdminPanel";
import { formatTimeRemaining, loadAuth, policyKey, storeAuth, playDoomscrollAlert, type SessionAuth, type SessionView } from "@/components/session-client";

const cachedSessionKey = (code: string) => `scrollstake:${code.toUpperCase()}:session`;

export default function SessionPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  const [session, setSession] = useState<SessionView | null>(null);
  const [auth, setAuth] = useState<SessionAuth | null>(null);
  const [localPolicy, setLocalPolicy] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const tokenRequestInFlight = useRef(false);
  const prevMembersRef = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "Session not found." : "Could not refresh the session.");
      const view = await response.json() as SessionView;
      setSession(view);
      sessionStorage.setItem(cachedSessionKey(code), JSON.stringify(view));
      const stored = loadAuth(code);
      const own = stored ? view.members.find((member) => member.wallet === stored.wallet) : undefined;
      if (stored && own && own.membershipStatus !== stored.membershipStatus) {
        const next = { ...stored, membershipStatus: own.membershipStatus };
        storeAuth(code, next);
        setAuth(next);
      }
      if (stored && own?.membershipStatus === "approved" && !stored.clientToken && !tokenRequestInFlight.current) {
        tokenRequestInFlight.current = true;
        try {
          const tokenResponse = await fetch(`/api/sessions/${encodeURIComponent(code)}/members/${encodeURIComponent(stored.wallet)}/token`, { method: "POST" });
          if (tokenResponse.ok) {
            const token = await tokenResponse.json() as { clientToken: string; membershipStatus: "approved" };
            const next = { ...stored, clientToken: token.clientToken, membershipStatus: token.membershipStatus };
            storeAuth(code, next);
            setAuth(next);
          }
        } finally {
          tokenRequestInFlight.current = false;
        }
      }
      setError("");
    } catch (cause) {
      try {
        const cached = sessionStorage.getItem(cachedSessionKey(code));
        if (cached) {
          setSession(JSON.parse(cached) as SessionView);
          setError("Backend unavailable — showing this browser's last saved session. Funding, room changes, and slashes are disabled until it reconnects.");
          return;
        }
      } catch { /* cache is optional */ }
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
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(interval); clearInterval(clock); };
  }, [code, refresh]);

  useEffect(() => {
    if (!session || !auth) return;
    const currentMembers = session.members;
    currentMembers.forEach(member => {
      const prevStrikes = prevMembersRef.current[member.wallet];
      if (prevStrikes !== undefined && member.strikes > prevStrikes && member.wallet !== auth.wallet) {
        void playDoomscrollAlert(session.penaltyUsdc, member.name);
      }
      prevMembersRef.current[member.wallet] = member.strikes;
    });
  }, [session, auth]);

  const allowedResources = useMemo(
    () => session?.monitoringPolicy?.allowedResources?.length ? session.monitoringPolicy.allowedResources : localPolicy,
    [localPolicy, session?.monitoringPolicy?.allowedResources],
  );
  const status = session?.status ?? "lobby";
  const scheduledEndReached = Boolean(session?.endsAt && now >= session.endsAt);
  const timeRemaining = formatTimeRemaining(session?.endsAt, now);

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
        <div style={{ textAlign: "right" }}><div className="muted">{timeRemaining && status === "live" ? `Time left · ${timeRemaining}` : "Signed in as"}</div><strong>{timeRemaining && status === "live" ? auth.name : auth.name}</strong></div>
      </header>
      {error && <p className="notice" role="alert">{error}</p>}
      {!session ? (
        <section className="card">Loading session…</section>
      ) : (
        <div className="session-layout">
          <div>
            <SessionAdminPanel session={session} auth={auth} onRefresh={refresh} />
            <FocusPulse code={code} live={status === "live" && !scheduledEndReached} />
            {status === "lobby" ? null : allowedResources.length > 0 && auth.clientToken ? (
              <FocusMonitor
                code={code}
                wallet={auth.wallet}
                userName={auth.name}
                clientToken={auth.clientToken}
                allowedResources={allowedResources}
                graceSeconds={session.monitoringPolicy?.graceSeconds ?? 3}
                sampleIntervalSeconds={session.monitoringPolicy?.sampleIntervalSeconds ?? 3}
                ended={status === "ended" || scheduledEndReached}
                onEvent={refresh}
              />
            ) : (
              <section className="card monitor">
                <div className="monitor-main">
                  <strong>{auth.clientToken ? "Policy pending" : "Approval pending"}</strong>
                  <p>{auth.clientToken ? "The creator&apos;s allowlist is not available from the session API yet. Monitoring stays off so an unknown policy cannot cost you money." : "The creator must approve your request before a monitoring token is issued."}</p>
                  <div className="notice">The lifecycle API must return approved membership and <code>monitoringPolicy.blockedSites</code> before monitoring can start.</div>
                </div>
              </section>
            )}
          </div>
          <aside style={{ display: "grid", gap: 18 }}>
            <section className="card">
              <span className="eyebrow">Blocked sites</span>
              <div className="policy-list">
                {allowedResources.length ? <p className="muted">{allowedResources.length} site{allowedResources.length === 1 ? "" : "s"} blocked by creator</p> : <p className="muted">No policy received.</p>}
              </div>
            </section>
            <section className="card">
              <span className="eyebrow">Group</span>
              <div className="member-list">
                {session.members.map((member) => (
                  <div className="member" key={member.wallet}>
                  <div className="member-head"><span>{member.name}</span></div>
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
