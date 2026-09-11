import { useState } from "react";
import { Button, Textarea } from "../../components/ui";

export function AppealForm({ pending, onRequest, reason: savedReason, onReasonChange }: { pending: boolean; onRequest: (reason: string) => void; reason?: string; onReasonChange?: (reason: string) => void }) {
  const [localReason, setLocalReason] = useState("");
  const reason = savedReason ?? localReason;
  return <form className="practice-form" onSubmit={event => { event.preventDefault(); if (!pending && reason.trim()) onRequest(reason.trim()); }}>
    <label>Reason for review<Textarea required maxLength={500} value={reason} onChange={event => { if (savedReason === undefined) setLocalReason(event.target.value); onReasonChange?.(event.target.value); }} /></label>
    <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>Request coach review</Button>
  </form>;
}
