import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { trainingApi } from "../../api/training";
import type { TrainingPreferences, WeeklyTarget } from "../../api/trainingTypes";
import { Button, Notice, Select } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { evidenceDate } from "./trainingAssets";

function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; }
  catch { return undefined; }
}

function supportedTimeZones(): string[] {
  try {
    const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supportedValuesOf === "function") return supportedValuesOf.call(Intl, "timeZone");
  } catch { /* Fall through to the curated list below. */ }
  return [];
}

// Used only where Intl.supportedValuesOf is unavailable (older runtimes).
const FALLBACK_TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];

export function WeeklyGoalDialog({ preferences, onClose }: { preferences: TrainingPreferences; onClose(): void }) {
  const [target, setTarget] = useState<WeeklyTarget>(preferences.pending?.weeklyTarget ?? preferences.weeklyTarget);
  const initialZone = preferences.pending?.timeZone ?? preferences.timeZone ?? deviceTimeZone() ?? "UTC";
  const [timeZone, setTimeZone] = useState(initialZone);
  const zones = useMemo(() => {
    const list = supportedTimeZones();
    const base = list.length > 0 ? list : FALLBACK_TIMEZONES;
    // "UTC" is a valid saved calendar but not a canonical IANA zone, so it never
    // appears in supportedValuesOf — always offer it alongside the device zone.
    const withUtc = base.includes("UTC") ? base : ["UTC", ...base];
    return withUtc.includes(initialZone) ? withUtc : [initialZone, ...withUtc];
  }, [initialZone]);
  const cache = useQueryClient();
  const save = useMutation({ mutationFn: () => trainingApi.savePreferences({ weeklyTarget: target, timeZone }), onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["training-today"] }); onClose(); } });
  return <TrainingDialog open title="Your weekly goal" onClose={onClose} pending={save.isPending}><form onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <p>Choose how many days to practice each week. Your first save sets your practice calendar. Later changes start next Monday in your timezone. Your saved practice stays in your history.</p>
    <label>Practice days per week<Select value={target} disabled={save.isPending} onChange={event => setTarget(Number(event.target.value) as WeeklyTarget)}>{[3, 4, 5].map(value => <option key={value} value={value}>{value} days</option>)}</Select></label>
    <label>Calendar timezone<Select value={timeZone} disabled={save.isPending} onChange={event => setTimeZone(event.target.value)} aria-describedby="training-timezone-help">{zones.map(zone => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}</Select></label><p id="training-timezone-help">Choose the calendar your weekly goal follows. Your device timezone is preselected when you have not chosen one yet.</p>{preferences.pending && <p>Scheduled goal: {preferences.pending.weeklyTarget} days, effective {evidenceDate(preferences.pending.effectiveAtUtc, preferences.timeZone)} ({preferences.timeZone}).</p>}
    {save.isError && <Notice tone="danger">Your goal could not be saved. Try again.</Notice>}
    <div className="training-controls"><Button variant="secondary" disabled={save.isPending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save goal"}</Button></div>
  </form></TrainingDialog>;
}
