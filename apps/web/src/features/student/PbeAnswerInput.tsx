import { Textarea } from '../../components/ui';
export function PbeAnswerInput({ partPoints, answers, onChange, disabled }: {
    partPoints: number[];
    answers: string[];
    onChange: (answers: string[]) => void;
    disabled: boolean;
}) {
    return <div className="mt-6 space-y-4">{partPoints.map((points, index) => <label className="block" key={index}>Answer {index + 1}<Textarea aria-label={`Answer ${index + 1}`} className="mt-2 w-full" rows={2} value={answers[index] ?? ''} onChange={event => onChange(partPoints.map((_, i) => i === index ? event.target.value : answers[i] ?? ''))} disabled={disabled} autoComplete="off" spellCheck={false}/><small>{points} {points === 1 ? 'point' : 'points'}</small></label>)}</div>;
}
