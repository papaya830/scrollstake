"use client";

import { useMemo, useState } from "react";
import type { Member, SessionAuth, SessionView } from "./session-client";

type Props = { session: SessionView; auth: SessionAuth; onRefresh: () => void };

type AdminAction = "approve" | "reject" | "remove" | "start" | "end";

function memberState(member: Member): "pending" | "approved" | "rejected" | "removed" {
  return member.membershipStatus ?? "approved";
}

export default function SessionAdminPanel({ session, auth, onRefresh }: Props) {
  const [busy, setBusy] = useState<AdminAction | null>(null);
  const [message, setMessage] = useState("");
  const [endReason, setEndReason] = useState("");
  const isCreator = auth.wallet === session.creatorWallet;
  const members = session.members.filter((member) => memberState(member) !== "removed");
  const pending = members.filter((member) => memberState(member) === "pending");
  const approved = members.filter((member) => memberState(member) === "approved");
  const unfunded = approved.filter((member) => !member.depositedAt);
  const duration = session.durationMinutes ?? 50;

  const startCopy = useMemo(() => {
    if (unfunded.length) return `Waiting for ${unfunded.length} approved member${unfunded.length === 1 ? "" : "s"} to deposit.`;
    return `All ${approved.length} approved member${approved.length === 1 ? "" : "s"} are funded.`;
  }, [approved.length, unfunded.length]);

  async function request(action: AdminAction, member?: Member) {
    setBusy(action);
    setMessage("");
    try {
      const path = member
        ? `/api/sessions/${encodeURIComponent(session.code)}/members/${encodeURIComponent(member.wallet)}`
        : `/api/sessions/${encodeURIComponent(session.code)}/${action}`;
      const body = action === "end" ? { reason: endReason.trim() } : member ? { action } : {};
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The admin action could not be completed.");
      setMessage(action === "start" ? "Session started and rules are now locked." : action === "end" ? "Session ended; members may withdraw their remaining stake." : "Member status updated.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The admin action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  if (session.status === "ended") {
    return (
      <section className="card">
        <span className="eyebrow">Session complete</span>
        <h2 style={{ marginBottom: 8 }}>Withdraw your remaining stake.</h2>
        <p className="muted">{session.endReason ? `Ended early: ${session.endReason}` : "The scheduled study timer has finished."}</p>
      </section>
    );
  }

  if (session.status !== "lobby") return null;

  if (!isCreator) {
    const own = session.members.find((member) => member.wallet === auth.wallet);
    const status = own ? memberState(own) : auth.membershipStatus ?? "pending";
    return (
      <section className="card lobby-state">
        <span className="eyebrow">Session lobby</span>
        <h2>{status === "pending" ? "Waiting for approval" : "Get your stake ready"}</h2>
        <p className="muted">{status === "pending" ? "The creator must approve your request before you can fund your stake or start monitoring." : "You are approved. Deposit your configured stake; the creator starts when every approved member is funded."}</p>
      </section>
    );
  }

  return (
    <section className="card admin-panel">
      <div className="monitor-top">
        <div><span className="eyebrow">Creator controls</span><h2 style={{ margin: "8px 0 0" }}>Build the room.</h2></div>
        <span className="status-pill"><span className="status-dot" />lobby</span>
      </div>
      <div className="admin-summary">
        <div><span>Timer</span><strong>{duration} min</strong></div>
        <div><span>Approved</span><strong>{approved.length}</strong></div>
        <div><span>Funded</span><strong>{approved.length - unfunded.length}/{approved.length}</strong></div>
      </div>
      {pending.length > 0 && <div className="admin-list"><span className="eyebrow">Join requests</span>{pending.map((member) => (
        <div className="admin-row" key={member.wallet}><div><strong>{member.name}</strong><span>{member.wallet}</span></div><div className="row-actions"><button className="button primary" disabled={busy !== null} onClick={() => void request("approve", member)}>Approve</button><button className="button" disabled={busy !== null} onClick={() => void request("reject", member)}>Decline</button></div></div>
      ))}</div>}
      <div className="admin-list"><span className="eyebrow">Approved members</span>{approved.map((member) => (
        <div className="admin-row" key={member.wallet}><div><strong>{member.name}{member.wallet === session.creatorWallet ? " · creator" : ""}</strong><span>{member.depositedAt ? "Stake funded" : "Deposit pending"}</span></div>{!member.depositedAt && member.wallet !== session.creatorWallet && <button className="button" disabled={busy !== null} onClick={() => void request("remove", member)}>Remove</button>}</div>
      ))}</div>
      <p className="fine">{startCopy} Starting locks membership, terms, approved resources, and the timer.</p>
      {message && <p className={message.includes("could not") || message.includes("not be") ? "error" : "event-toast"}>{message}</p>}
      <button className="button primary" disabled={busy !== null || unfunded.length > 0 || approved.length === 0} onClick={() => void request("start")}>{busy === "start" ? "Starting…" : `Start ${duration}-minute session`}</button>
    </section>
  );
}
