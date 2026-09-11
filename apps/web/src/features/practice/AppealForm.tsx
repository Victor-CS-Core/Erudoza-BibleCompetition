import { useState } from "react";
import { Button, Textarea } from "../../components/ui";

export function AppealForm({ pending, onRequest }: { pending: boolean; onRequest: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <form className="practice-form" onSubmit={event => { event.preventDefault(); if (!pending && reason.trim()) onRequest(reason.trim()); }}>
    <label>Reason for review<Textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>Request coach review</Button>
  </form>;
}
