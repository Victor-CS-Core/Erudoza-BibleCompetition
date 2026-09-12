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

  return <div ref={passage} className="er-scripture" aria-label="Passage with missing words" role="group"
    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', minWidth: 0, width: '100%', overflowWrap: 'anywhere' }}>
    {tokens.map(token => {
      if (!token.hidden) return <span key={token.index}>{token.display}</span>;
      const ordinal = ordinalByIndex.get(token.index)!;
      const value = values[token.index] ?? '';
      const result = resultByIndex.get(token.index);
      const resultId = result ? `missing-word-result-${token.index}` : undefined;
      return <span key={token.index} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch', fontFamily: 'var(--er-font-ui)', minWidth: 0, maxWidth: '100%', width: `max(5rem, ${Math.max(5, Math.min(32, value.length + 2))}ch)` }}>
        <Input
          data-missing-word-slot=""
          aria-label={`Blank ${ordinal} of ${hidden.length}`}
          aria-describedby={resultId}
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
          style={{ minWidth: 'min(5rem, 100%)', width: '100%', minHeight: '44px', maxWidth: '100%', fontFamily: 'var(--er-font-ui)' }}
        />
        {result && <small id={resultId} role="status" style={{ overflowWrap: 'anywhere', maxWidth: '100%' }}>
          {result.isCorrect ? `Blank ${ordinal}: Correct` : `Blank ${ordinal}: Review the source. Expected: ${result.expected}`}
        </small>}
      </span>;
    })}
  </div>;
}
