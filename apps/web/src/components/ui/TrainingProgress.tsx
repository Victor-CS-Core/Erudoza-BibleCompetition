import type { TrainingWeek } from "../../api/trainingTypes";
import { AppIcon } from "../AppIcon";

export function ProgressMeter({ label, value, max, hideCaption = false }: { label: string; value: number; max: number; hideCaption?: boolean }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const safeValue = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
  return <div className="ds-progress-meter"><progress aria-label={label} value={safeValue} max={safeMax || 1} />{!hideCaption && <span>{safeValue} of {safeMax}</span>}</div>;
}

export function WeeklyProgressStrip({ week }: { week: TrainingWeek }) {
  return <ol className="ds-week-strip" aria-label="Practice days this week">{week.days.map(day => {
    const date = new Date(day.localDate + "T12:00:00Z");
    const label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    return <li key={day.localDate} aria-current={day.isToday ? "date" : undefined} aria-label={`${label}: ${day.isToday ? "today, " : ""}${day.credited ? "practiced" : "not yet practiced"}`}>
      <span aria-hidden="true">{date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}</span>
      <span aria-hidden="true" className={day.credited ? "ds-week-day ds-week-day-credited" : "ds-week-day"}>{day.credited ? <AppIcon name="check" /> : date.getUTCDate()}</span>
    </li>;
  })}</ol>;
}
