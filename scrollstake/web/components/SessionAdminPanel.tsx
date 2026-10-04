"use client";

import { useEffect, useMemo, useState } from "react";
import type { Member, SessionAuth, SessionView } from "./session-client";
import { depositOnChain, withdrawOnChain } from "@/lib/solana-client";

type Props = { session: SessionView; auth: SessionAuth; onRefresh: () => void | Promise<void> };
type AdminAction = "approve" | "reject" | "remove" | "deposit" | "start" | "end";
const memberState = (member: Member) => member.membershipStatus ?? "approved";

export default function SessionAdminPanel({ session, auth, onRefresh }: Props) {
  const [busy, setBusy] = useState<AdminAction | null>(null);
  const [message, setMessage] = useState("");
  // null = real-chain mode; otherwise the env vars the server reports missing.
  const [dryRunMissing, setDryRunMissing] = useState<string[] | null>(null);
  useEffect(() => {
    if (session.groupTx) return;
    void fetch("/api/chain/config", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) setDryRunMissing(((await response.json().catch(() => ({}))) as { missing?: string[] }).missing ?? []);
    }).catch(() => setDryRunMissing([]));
  }, [session.groupTx]);
  const dryRunBanner = !session.groupTx && <p className="notice">{dryRunMissing ? `Dry-run mode: no devnet transactions are sent and wallets will not change.${dryRunMissing.length ? ` Server is missing: ${dryRunMissing.join(", ")}.` : ""}` : "This room has no on-chain group, so deposits cannot reach devnet. Create a new room."}</p>;
  const isCreator = auth.wallet === session.creatorWallet;
  const members = session.members.filter((member) => memberState(member) !== "removed");
  const pending = members.filter((member) => memberState(member) === "pending");
  const approved = members.filter((member) => memberState(member) === "approved");
  const unfunded = approved.filter((member) => !member.depositedAt);
  const own = session.members.find((member) => member.wallet === auth.wallet);
  const duration = session.durationMinutes ?? 50;
  const startCopy = useMemo(() => unfunded.length ? `Waiting for ${unfunded.length} approved member${unfunded.length === 1 ? "" : "s"} to fund their demo stake.` : `All ${approved.length} approved member${approved.length === 1 ? "" : "s"} are funded.`, [approved.length, unfunded.length]);

  async function request(action: AdminAction, member?: Member, endReason?: string) {
    setBusy(action); setMessage("");
    try {
      const target = member ?? (action === "deposit" ? own : undefined);
      const path = target && action !== "start" && action !== "end" ? `/api/sessions/${encodeURIComponent(session.code)}/members/${encodeURIComponent(target.wallet)}` : `/api/sessions/${encodeURIComponent(session.code)}/${action}`;
      let txSig: string | undefined;
      if (action === "deposit") {
        if (session.groupTx) {
          const chain = await depositOnChain(session.code, session.stakeUsdc);
          if (chain.wallet !== auth.wallet) throw new Error("The connected wallet must match the session wallet.");
          txSig = chain.txSig;
        } else if (dryRunMissing) txSig = `DRYRUN_${Date.now()}`;
        else throw new Error("This room has no on-chain group, so deposits cannot reach devnet. Create a new room.");
      }
      const body = action === "deposit" ? { action, txSig } : action === "end" ? { actorWallet: auth.wallet, reason: endReason } : action === "start" ? { actorWallet: auth.wallet } : { action, actorWallet: auth.wallet };
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The session action could not be completed.");
      setMessage(action === "deposit" ? (session.groupTx ? "On-chain stake confirmed. You are ready to start." : "Demo stake funded. You are ready to start.") : action === "start" ? "Session started and rules are locked." : action === "end" ? "Session ended; members may withdraw their remaining stake." : "Member status updated.");
      await onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The session action could not be completed."); }
    finally { setBusy(null); }
  }

  function requestEnd() {
    if (!window.confirm("End this session for everyone? Monitoring will stop.")) return;
    const reason = window.prompt("Optional end reason") ?? undefined;
    void request("end", undefined, reason);
  }

  async function copyInviteLink() {
    const inviteUrl = `${window.location.origin}/s/${encodeURIComponent(session.code)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Invite link copied. Send it to your study group.");
    } catch {
      setMessage(`Copy this invite link: ${inviteUrl}`);
    }
  }

  if (session.status === "ended") return <section className="card"><span className="eyebrow">Session complete</span><h2 style={{ marginBottom: 8 }}>Withdraw your remaining stake.</h2><p className="muted">{session.endReason ? `Ended: ${session.endReason}` : "The scheduled study timer has finished."}</p>{session.groupTx && <button className="button primary" disabled={busy !== null} onClick={() => { setBusy("deposit"); setMessage(""); void withdrawOnChain(session.code).then(() => setMessage("Withdrawal confirmed on devnet.")).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : "Withdrawal failed.")).finally(() => setBusy(null)); }}>{busy === "deposit" ? "Withdrawing…" : "Withdraw remaining stake"}</button>}{message && <p className={message.includes("failed") ? "error" : "event-toast"}>{message}</p>}</section>;
  if (session.status === "live") return isCreator
    ? <section className="card admin-panel"><span className="eyebrow">Creator controls</span><h2 style={{ margin: "8px 0" }}>Room is live.</h2><p className="muted">Ending stops monitoring for everyone and unlocks withdrawals.</p>{message && <p className={message.includes("could not") || message.includes("cannot") ? "error" : "event-toast"}>{message}</p>}<button className="button danger" disabled={busy !== null} onClick={requestEnd}>{busy === "end" ? "Ending…" : "End session"}</button></section>
    : <section className="card lobby-state"><span className="eyebrow">Session live</span><h2>Stay locked in.</h2><p className="muted">The creator can end the room early. The timer ends it automatically.</p></section>;

  if (!isCreator) {
    const status = own ? memberState(own) : auth.membershipStatus ?? "pending";
    if (status === "rejected" || status === "removed") return <section className="card lobby-state"><span className="eyebrow">Room access</span><h2>{status === "rejected" ? "Request declined" : "Removed from room"}</h2><p className="muted">You cannot fund or monitor in this session.</p></section>;
    const funded = Boolean(own?.depositedAt);
    return <section className="card lobby-state"><span className="eyebrow">Session lobby</span><h2>{status === "pending" ? "Waiting for approval" : funded ? "Demo stake funded" : "Fund your demo stake"}</h2><p className="muted">{status === "pending" ? "The creator must approve your request before you can receive a monitoring token or fund your stake." : funded ? "You are ready. The creator can start once every approved member is funded." : "This dry-run receipt unlocks the local two-browser demo; no USDC moves."}</p>{status === "approved" && !funded && dryRunBanner}{status === "approved" && !funded && <button className="button primary" disabled={busy !== null} onClick={() => void request("deposit")}>{busy === "deposit" ? "Funding…" : `Fund $${session.stakeUsdc.toFixed(2)} demo stake`}</button>}{message && <p className={message.includes("could not") || message.includes("cannot") ? "error" : "event-toast"}>{message}</p>}</section>;
  }

  return <section className="card admin-panel">
    <div className="monitor-top"><div><span className="eyebrow">Creator controls</span><h2 style={{ margin: "8px 0 0" }}>Build the room.</h2></div><span className="status-pill"><span className="status-dot" />lobby</span></div>
    <div className="admin-summary"><div><span>Timer</span><strong>{duration} min</strong></div><div><span>Approved</span><strong>{approved.length}</strong></div><div><span>Funded</span><strong>{approved.length - unfunded.length}/{approved.length}</strong></div></div>
    {dryRunBanner}
    <button className="button" disabled={busy !== null} onClick={() => void copyInviteLink()}>Copy invite link</button>
    {pending.length > 0 && <div className="admin-list"><span className="eyebrow">Join requests</span>{pending.map((member) => <div className="admin-row" key={member.wallet}><div><strong>{member.name}</strong><span>{member.wallet}</span></div><div className="row-actions"><button className="button primary" disabled={busy !== null} onClick={() => void request("approve", member)}>Approve</button><button className="button" disabled={busy !== null} onClick={() => void request("reject", member)}>Decline</button></div></div>)}</div>}
    <div className="admin-list"><span className="eyebrow">Approved members</span>{approved.map((member) => <div className="admin-row" key={member.wallet}><div><strong>{member.name}{member.wallet === session.creatorWallet ? " · creator" : ""}</strong><span>{member.depositedAt ? "Demo stake funded" : "Deposit pending"}</span></div><div className="row-actions">{member.wallet === auth.wallet && !member.depositedAt && <button className="button primary" disabled={busy !== null} onClick={() => void request("deposit", member)}>{busy === "deposit" ? "Funding…" : "Fund demo stake"}</button>}{!member.depositedAt && member.wallet !== session.creatorWallet && <button className="button" disabled={busy !== null} onClick={() => void request("remove", member)}>Remove</button>}</div></div>)}</div>
    <p className="fine">{startCopy} Demo funding does not move USDC. Starting locks membership, terms, approved resources, and the timer.</p>
    {message && <p className={message.includes("could not") || message.includes("cannot") ? "error" : "event-toast"}>{message}</p>}
    <button className="button primary" disabled={busy !== null || unfunded.length > 0 || approved.length === 0} onClick={() => void request("start")}>{busy === "start" ? "Starting…" : `Start ${duration}-minute session`}</button>
  </section>;
}
