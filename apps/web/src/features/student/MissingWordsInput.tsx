import { useRef } from 'react';
import type { ChallengeCard } from '../../api/types';
import { Input } from '../../components/ui';

type MissingWordResult = { index: number; isCorrect: boolean; expected: string };

export function MissingWordsInput({ tokens, values, onChange, disabled, results }: {
  tokens: ChallengeCard['tokens'];
  values: Record<number, string>;
  onChange(values: Record<number, string>): void;
  disabled: boolean;
  results?: MissingWordResult[];
}) {
  const passage = useRef<HTMLDivElement>(null);
  const hidden = tokens.filter(token => token.hidden);
  const ordinalByIndex = new Map(hidden.map((token, ordinal) => [token.index, ordinal + 1]));
  const resultByIndex = new Map(results?.map(result => [result.index, result]));
  const correctCount = results?.filter(result => result.isCorrect).length ?? 0;
  const reviewOrdinals = (results ?? [])
    .filter(result => !result.isCorrect)
    .map(result => ordinalByIndex.get(result.index))
    .filter((ordinal): ordinal is number => ordinal !== undefined);

  return <>
    <div ref={passage} className="er-scripture" aria-label="Passage with missing words" role="group"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', minWidth: 0, width: '100%', overflowWrap: 'anywhere' }}>
      {tokens.map(token => {
        if (!token.hidden) return <span key={token.index}>{token.display}</span>;
        const ordinal = ordinalByIndex.get(token.index)!;
        const value = values[token.index] ?? '';
        const result = resultByIndex.get(token.index);
        const underline = result
          ? result.isCorrect ? 'var(--er-success-ink)' : 'var(--er-coral)'
          : 'var(--er-blank-underline)';
        return <Input
          key={token.index}
          data-missing-word-slot=""
          aria-label={`Blank ${ordinal} of ${hidden.length}`}
          aria-invalid={result ? !result.isCorrect : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint={ordinal < hidden.length ? 'next' : 'done'}
          disabled={disabled}
          value={value}
          onChange={event => {
            if (!disabled) onChange({ ...values, [token.index]: event.target.value });
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
      {correctCount} of {hidden.length} correct{reviewOrdinals.length > 0 && ` — review ${reviewOrdinals.map(ordinal => `blank ${ordinal}`).join(', ')}`}
    </p>}
  </>;
}
