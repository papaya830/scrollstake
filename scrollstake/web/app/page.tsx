import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand"><span className="brand-mark">●</span> ScrollStake</div>
        <span className="eyebrow">Focus protocol</span>
      </nav>
      <section className="hero">
        <div>
          <div className="eyebrow">Study like you mean it</div>
          <h1>Put money on your <em>focus.</em></h1>
          <p className="lede">
            Start a study room, stake USDC, and share your screen. Doomscroll past the grace period and your stake funds the group hangout.
          </p>
          <div className="actions">
            <Link className="button primary" href="/create">Create a session</Link>
            <Link className="button" href="/join">Join with a code</Link>
          </div>
          <p className="preview-hint">
            Not ready to stake? <Link href="/preview">Try a 30-second preview, no wallet needed →</Link>
          </p>
        </div>
        <aside className="stake-card">
          <span className="eyebrow">Example stake</span>
          <div className="amount">$10.00</div>
          <div className="muted">USDC committed</div>
          <div className="rule" />
          <div className="member-head"><span>Focus streak</span><span>48 min</span></div>
          <div className="member-head" style={{ marginTop: 14 }}><span>Grace period</span><span>3 sec</span></div>
          <div className="member-head" style={{ marginTop: 14 }}><span>Penalty</span><span>$0.50</span></div>
        </aside>
      </section>
    </main>
  );
}
