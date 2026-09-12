import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/ui';

export function VerseBuilderInput({ tokens, selected, onChange, disabled }: {
  tokens: { index: number; display: string }[];
  selected: number[];
  onChange(ids: number[]): void;
  disabled: boolean;
}) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const undo = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | 'undo' | undefined>(undefined);
  // Focus after the controlled selection updates, when the destination is enabled.
  useLayoutEffect(() => {
    if (pendingFocus.current !== undefined) {
      (pendingFocus.current === 'undo' ? undo.current : buttons.current.get(pendingFocus.current))?.focus();
      pendingFocus.current = undefined;
    }
  }, [selected]);
  const available = tokens.filter(token => !selected.includes(token.index));
  return <div className="mt-6 space-y-3" aria-label="Verse builder">
    <p>Choose each phrase in verse order.</p>
    <p className="er-scripture" aria-label="Your verse" aria-live="polite">
      {selected.map(id => tokens.find(t => t.index === id)?.display).join(' ') || 'Your verse will appear here.'}
    </p>
    <div className="flex flex-wrap gap-2">
      {tokens.map(token => <Button key={token.index} ref={button => {
        if (button) buttons.current.set(token.index, button);
        else buttons.current.delete(token.index);
      }} type="button" variant="secondary" className="max-w-full whitespace-normal text-left"
        aria-label={`Add ${token.display}`} disabled={disabled || selected.includes(token.index)}
        onClick={() => {
          pendingFocus.current = available.find(t => t.index !== token.index)?.index ?? 'undo';
          onChange([...selected, token.index]);
        }}>{token.display}</Button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button ref={undo} type="button" variant="secondary" disabled={disabled || !selected.length}
        onClick={() => {
          if (selected.length === 1) pendingFocus.current = selected[0];
          onChange(selected.slice(0, -1));
        }}>Undo last phrase</Button>
      <Button type="button" variant="ghost" disabled={disabled || !selected.length}
        onClick={() => {
          pendingFocus.current = tokens[0]?.index;
          onChange([]);
        }}>Clear verse</Button>
    </div>
  </div>;
}
