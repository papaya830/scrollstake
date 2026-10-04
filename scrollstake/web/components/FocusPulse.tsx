"use client";

import { useEffect, useMemo, useState } from "react";

type Point = { bucket: string; wallet: string; focusedSamples: number; distractions: number; forgiven: number; slashes: number; penaltyUsdc: number };
type Member = { wallet: string; name: string; focusedSamples: number; distractions: number; forgiven: number; slashes: number; penaltyUsdc: number };
type Payload = { points: Point[]; members: Member[] };

export default function FocusPulse({ code, live }: { code: string; live: boolean }) {
  const [data, setData] = useState<Payload>({ points: [], members: [] });
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch(`/api/analytics?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("analytics unavailable");
        if (!cancelled) { setData(await response.json() as Payload); setAvailable(true); }
      } catch { if (!cancelled) setAvailable(false); }
    }
    void refresh();
    const timer = live ? setInterval(() => void refresh(), 10_000) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [code, live]);

  const buckets = useMemo(() => {
    const grouped = new Map<string, { focused: number; distractions: number }>();
    for (const point of data.points) {
      const item = grouped.get(point.bucket) ?? { focused: 0, distractions: 0 };
      item.focused += point.focusedSamples;
      item.distractions += point.distractions;
      grouped.set(point.bucket, item);
    }
    return [...grouped.values()].slice(-24);
  }, [data.points]);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.focused + bucket.distractions));

  return <section className="card focus-pulse">
    <div className="monitor-top"><div><span className="eyebrow">Tiger Data · live analytics</span><h2 style={{ margin: "8px 0 0" }}>Focus pulse</h2></div><span className={`status-pill ${available ? "monitoring" : "degraded"}`}><span className="status-dot" />{available ? "live" : "waiting"}</span></div>
    {!available ? <p className="muted">Connect Tiger Cloud and run the analytics migration to show the live pulse.</p> : buckets.length === 0 ? <p className="muted">Waiting for the first local focus heartbeat. No screen or camera content is stored.</p> : <div className="pulse-bars" aria-label="Focus pulse over time">{buckets.map((bucket, index) => <div className="pulse-bar" key={index} title={`${bucket.focused} focus samples, ${bucket.distractions} distractions`}><div className="pulse-focus" style={{ height: `${(bucket.focused / max) * 100}%` }} /><div className="pulse-distraction" style={{ height: `${(bucket.distractions / max) * 100}%` }} /></div>)}</div>}
    <div className="pulse-members">{data.members.map((member) => <div className="pulse-member" key={member.wallet}><strong>{member.name}</strong><span>{member.focusedSamples} locked-in samples</span><span>{member.forgiven} saves · {member.slashes} slashes · ${member.penaltyUsdc.toFixed(2)}</span></div>)}</div>
  </section>;
}
