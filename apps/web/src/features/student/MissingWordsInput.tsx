import { useRef } from 'react';
import type { ChallengeCard } from '../../api/types';
import { Input } from '../../components/ui';

type MissingWordResult = { index: number; isCorrect: boolean; expected: string; spelling?: boolean; /** The blank was a spelling slip that the second chance corrected — partial credit, shown gold rather than the plain correct green. */ corrected?: boolean };

export function MissingWordsInput({ tokens, values, onChange, disabled, results, editableIndexes, fixResults }: {
  tokens: ChallengeCard['tokens'];
  values: Record<number, string>;
  onChange(values: Record<number, string>): void;
  disabled: boolean;
  results?: MissingWordResult[];
  /** Spelling-fix mode: only these blank indexes stay editable; every
   * other slot is locked even when `disabled` is false. */
  editableIndexes?: number[];
  /** Per-blank verdicts of a used spelling second chance, for the
   * post-fix notes under the verse. */
  fixResults?: { index: number; isCorrect: boolean; expected: string }[];
}) {
  const passage = useRef<HTMLDivElement>(null);
  const hidden = tokens.filter(token => token.hidden);
  const ordinalByIndex = new Map(hidden.map((token, ordinal) => [token.index, ordinal + 1]));
  const resultByIndex = new Map(results?.map(result => [result.index, result]));
  const correctedCount = results?.filter(result => result.corrected).length ?? 0;
  const correctCount = (results?.filter(result => result.isCorrect).length ?? 0) - correctedCount;
  const reviewOrdinals = (results ?? [])
    .filter(result => !result.isCorrect)
    .map(result => ordinalByIndex.get(result.index))
    .filter((ordinal): ordinal is number => ordinal !== undefined);
  // A wrong slot the server flagged as a near-miss spelling of the expected
  // word gets the same callout the word-diff feedback uses for text answers
  // (StudyPage): it still counts wrong here, but it is named as a spelling
  // slip, not a wrong word.
  // Slots with a fix verdict — or currently open in fix mode — no longer
  // show the pre-fix spelling note (it would restate itself while typing).
  const fixIndexes = new Set([...(fixResults ?? []).map(result => result.index), ...(editableIndexes ?? [])]);
  const spellingResults = (results ?? []).filter(result => !result.isCorrect && result.spelling && !fixIndexes.has(result.index));

  return <>
    <div ref={passage} className="er-scripture" aria-label="Fill-in-the-blank passage" role="group"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', minWidth: 0, width: '100%', overflowWrap: 'anywhere' }}>
      {tokens.map(token => {
        if (!token.hidden) return <span key={token.index}>{token.display}</span>;
        const ordinal = ordinalByIndex.get(token.index)!;
        const value = values[token.index] ?? '';
        const result = resultByIndex.get(token.index);
        const isSpelling = !!result && !result.isCorrect && !!result.spelling;
        const slotDisabled = disabled || (editableIndexes !== undefined && !editableIndexes.includes(token.index));
        const underline = result
          ? result.corrected ? 'var(--er-thread-gold)' : result.isCorrect ? 'var(--er-success-ink)' : isSpelling ? 'var(--er-teal)' : 'var(--er-coral)'
          : 'var(--er-blank-underline)';
        return <Input
          key={token.index}
          data-missing-word-slot=""
          data-spelling-slip={isSpelling || undefined}
          data-spelling-corrected={result?.corrected || undefined}
          className={isSpelling ? 'diff-spelling' : undefined}
          aria-label={`Blank ${ordinal} of ${hidden.length}`}
          aria-invalid={result ? !result.isCorrect : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint={ordinal < hidden.length ? 'next' : 'done'}
          disabled={slotDisabled}
          value={value}
          onChange={event => {
            if (!slotDisabled) onChange({ ...values, [token.index]: event.target.value });
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (event.nativeEvent.isComposing) return;
            const fields = passage.current?.querySelectorAll<HTMLInputElement>('input[data-missing-word-slot]');
            if (ordinal < hidden.length) fields?.[ordinal]?.focus();
            else event.currentTarget.blur();
          }}
          style={{
            display: 'inline-block',
            minWidth: '5ch',
            width: `${Math.max(5, Math.min(32, value.length + 2))}ch`,
            maxWidth: '100%',
            minHeight: '1.75em',
            height: '1.75em',
            padding: '0.1em 0.35em',
            margin: 0,
            border: 'none',
            borderBottom: `2px solid ${underline}`,
            borderRadius: 0,
            background: 'transparent',
            font: 'inherit',
            color: 'inherit',
            verticalAlign: 'baseline',
          }}
        />;
      })}
    </div>
    {results && <p data-testid="missing-words-summary" role="status" style={{ fontSize: 'var(--er-text-sm)', color: 'var(--er-muted-ink)', marginTop: 'var(--er-space-3)' }}>
      {correctCount} of {hidden.length} correct{correctedCount > 0 && ` · ${correctedCount} fixed for spelling`}{reviewOrdinals.length > 0 && ` — review ${reviewOrdinals.map(ordinal => `blank ${ordinal}`).join(', ')}`}
    </p>}
    {spellingResults.length > 0 && <div data-testid="missing-words-spelling">
      {spellingResults.map(result => <p key={result.index} className="text-sm" style={{ marginTop: 'var(--er-space-2)' }}>
        {`Spelling: you wrote “${values[result.index] ?? ''}” for “${result.expected}” — a spelling slip, not a wrong word.`}
      </p>)}
    </div>}
    {fixResults && fixResults.length > 0 && <div data-testid="missing-words-spelling-fix">
      {fixResults.map(result => <p key={result.index} className="text-sm" style={{ marginTop: 'var(--er-space-2)' }}>
        {result.isCorrect
          ? `Spelling fixed: “${result.expected}” — that blank earns partial credit now.`
          : `The verse says “${result.expected}”.`}
      </p>)}
    </div>}
  </>;
}
