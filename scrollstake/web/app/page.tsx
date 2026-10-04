import Link from "next/link";

const ROOM = [
  { name: "Camille", note: "Locked in · 48 min", tone: "ok", initial: "C" },
  { name: "Alex", note: "1 slip · $0.50", tone: "slip", initial: "A" },
  { name: "Priya", note: "Locked in · 31 min", tone: "ok", initial: "P" },
  { name: "Jordan", note: "2 free passes left", tone: "wait", initial: "J" },
];

export default function Home() {
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand">ScrollStake</div>
        <div className="nav-links">
          <Link href="/join">Join a room</Link>
          <Link className="button primary" href="/create">Start a room</Link>
        </div>
      </nav>
      <section className="hero">
        <div>
          <h1>Put money on your <em>focus.</em></h1>
          <p className="lede">
            Open a study room, stake USDC with your friends, and share your screen. Slip past the grace period and that money stays in the group jar.
          </p>
          <div className="actions">
            <Link className="button primary" href="/create">Create a session</Link>
            <Link className="button" href="/join">I have a code</Link>
          </div>
        </div>
        <aside className="room">
          <div className="room-top">
            <strong>Saturday room</strong>
            <span>4 people</span>
          </div>
          <div className="room-list">
            {ROOM.map((person) => (
              <div className="person" key={person.name}>
                <span className={`avatar ${person.tone}`}>{person.initial}</span>
                <div>
                  <strong>{person.name}</strong>
                  <span>{person.note}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="room-foot">
            <span>$40 in the jar</span>
            <span>$0.50 a slip</span>
          </div>
        </aside>
      </section>
      <section className="facts">
        <article>
          <h2>Stake together</h2>
          <p>Everyone puts the same amount in before the timer starts.</p>
        </article>
        <article>
          <h2>Share the screen</h2>
          <p>The check stays on your device. A slip gets ten seconds to disappear.</p>
        </article>
        <article>
          <h2>The jar stays with the group</h2>
          <p>Slashed money is the hangout fund, not a payout to one friend.</p>
        </article>
      </section>
    </main>
  );
}
