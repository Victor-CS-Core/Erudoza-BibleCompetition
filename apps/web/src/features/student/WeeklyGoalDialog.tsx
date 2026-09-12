import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { trainingApi } from "../../api/training";
import type { TrainingPreferences, WeeklyTarget } from "../../api/trainingTypes";
import { Button, Input, Notice, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { evidenceDate } from "./trainingAssets";
export function WeeklyGoalDialog({ preferences, onClose }: { preferences: TrainingPreferences; onClose(): void }) {
  const [target, setTarget] = useState<WeeklyTarget>(preferences.pending?.weeklyTarget ?? preferences.weeklyTarget);
  const [timeZone, setTimeZone] = useState(preferences.pending?.timeZone ?? preferences.timeZone);
  let validTimeZone = false;
  try { new Intl.DateTimeFormat("en", { timeZone: timeZone.trim() }).format(); validTimeZone = !!timeZone.trim(); } catch { /* The API independently validates calendar names. */ }
  const cache = useQueryClient();
  const save = useMutation({ mutationFn: () => trainingApi.savePreferences({ weeklyTarget: target, timeZone: timeZone.trim() }), onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["training-today"] }); onClose(); } });
  return <TrainingDialog open title="Your weekly goal" onClose={onClose} pending={save.isPending}><form onSubmit={event => { event.preventDefault(); if (validTimeZone) save.mutate(); }}>
    <p>Choose how many days to practice each week. Your first save sets your practice calendar. Later changes start next Monday in your timezone. Your saved practice stays in your history.</p>
    <label>Practice days per week<Select value={target} disabled={save.isPending} onChange={event => setTarget(Number(event.target.value) as WeeklyTarget)}>{[3, 4, 5].map(value => <option key={value} value={value}>{value} days</option>)}</Select></label>
    <label>Calendar timezone<Input value={timeZone} onChange={event => setTimeZone(event.target.value)} disabled={save.isPending} aria-invalid={!validTimeZone} aria-describedby="training-timezone-help" required /></label><p id="training-timezone-help">Use an IANA timezone such as America/New_York or Europe/London. Confirm this calendar before saving; UTC may be the initial default.</p>{!validTimeZone && <Notice tone="danger">Enter a valid IANA timezone.</Notice>}{preferences.pending && <p>Scheduled goal: {preferences.pending.weeklyTarget} days, effective {evidenceDate(preferences.pending.effectiveAtUtc, preferences.timeZone)} ({preferences.timeZone}).</p>}
    {save.isError && <Notice tone="danger">Your goal could not be saved. Try again.</Notice>}
    <div className="training-controls"><Button variant="secondary" disabled={save.isPending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending || !validTimeZone}>{save.isPending ? "Saving…" : "Save goal"}</Button></div>
  </form></TrainingDialog>;
}
