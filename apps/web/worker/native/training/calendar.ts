import type { TrainingPreferences } from '../../../src/api/trainingTypes';
import { HttpError } from '../types';
export function validateZone(zone: string) {
    try {
        if (typeof zone !== 'string' || !zone || (!zone.includes('/') && zone !== 'UTC'))
            throw new Error();
        new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
        return zone;
    }
    catch {
        throw new HttpError(400, 'Choose a supported IANA time zone.');
    }
}
export function effectivePreferences(now: string, p: TrainingPreferences): TrainingPreferences { return p.pending && now >= p.pending.effectiveAtUtc ? { timeZone: p.pending.timeZone, weeklyTarget: p.pending.weeklyTarget, pending: null } : p; }
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function parts(at: number, zone: string) { return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(p => [p.type, p.value])); }
function midnight(date: string, zone: string) {
    const target = Date.parse(`${date}T00:00:00Z`);
    let at = target;
    for (let i = 0; i < 5; i++) {
        const p = parts(at, zone);
        const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
        const delta = target - wall;
        at += delta;
        if (!delta)
            break;
    }
    return new Date(at).toISOString();
}
export function resolveTrainingCalendar(nowUtc: string, preferences: TrainingPreferences) { const p = effectivePreferences(nowUtc, preferences), timeZone = validateZone(p.timeZone), d = parts(Date.parse(nowUtc), timeZone); const localDate = `${d.year}-${d.month}-${d.day}`, dow = new Date(`${localDate}T12:00:00Z`).getUTCDay(), weekStartLocalDate = addDays(localDate, -((dow + 6) % 7)); return { localDate, weekStartLocalDate, nextWeekAtUtc: midnight(addDays(weekStartLocalDate, 7), timeZone), timeZone }; }
