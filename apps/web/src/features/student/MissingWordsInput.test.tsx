import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MissingWordsInput } from './MissingWordsInput';

const tokens = [
  { index: 0, display: 'And', hidden: false },
  { index: 2, display: '____', hidden: true },
  { index: 3, display: '____', hidden: true },
  { index: 5, display: 'unto', hidden: false },
  { index: 8, display: '____', hidden: true },
  { index: 11, display: '____', hidden: true },
];

it('keeps adjacent and repeated blanks keyed to their own public token indices', () => {
  const changed = vi.fn();
  function Harness() {
    const [values, setValues] = useState<Record<number, string>>({ 2: '', 3: '', 8: '', 11: '' });
    return <MissingWordsInput tokens={tokens} values={values} disabled={false} onChange={next => { changed(next); setValues(next); }} />;
  }

  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Blank 1 of 4'), { target: { value: 'sent' } });
  fireEvent.change(screen.getByLabelText('Blank 2 of 4'), { target: { value: 'letters' } });

  expect(changed).toHaveBeenLastCalledWith({ 2: 'sent', 3: 'letters', 8: '', 11: '' });
  expect(screen.getByLabelText('Blank 1 of 4')).toHaveValue('sent');
  expect(screen.getByLabelText('Blank 2 of 4')).toHaveValue('letters');
  expect(screen.queryByText('Type the missing phrase')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Type the missing phrase' })).not.toBeInTheDocument();
});

it('uses recall-safe input attributes and locks every slot while pending', () => {
  const changed = vi.fn();
  render(<MissingWordsInput tokens={tokens} values={{ 2: 'kept' }} disabled onChange={changed} />);

  const fields = screen.getAllByRole('textbox');
  expect(fields).toHaveLength(4);
  for (const field of fields) {
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(field).not.toHaveAttribute('placeholder');
    fireEvent.change(field, { target: { value: 'changed' } });
  }
  expect(changed).not.toHaveBeenCalled();
});

it('announces one summary line instead of per-blank stacked feedback', () => {
  render(<MissingWordsInput tokens={tokens} values={{ 2: 'sent', 3: 'mail' }} disabled={false} onChange={vi.fn()}
    results={[{ index: 3, isCorrect: false, expected: 'letters' }, { index: 2, isCorrect: true, expected: 'sent' }]} />);

  const summary = screen.getByTestId('missing-words-summary');
  expect(summary).toHaveAttribute('role', 'status');
  expect(summary).toHaveTextContent('1 of 4 correct — review blank 2');
  expect(screen.queryByText('Blank 1: Correct')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Blank 1 of 4')).toHaveStyle({ borderBottom: '2px solid var(--er-success-ink)' });
  expect(screen.getByLabelText('Blank 2 of 4')).toHaveStyle({ borderBottom: '2px solid var(--er-coral)' });
});

it('offers mobile Next and Done navigation without implicit submission or composition interruption', () => {
  const submitted = vi.fn();
  render(<form onSubmit={event => { event.preventDefault(); submitted(); }}>
    <MissingWordsInput tokens={tokens} values={{}} disabled={false} onChange={vi.fn()} />
    <button type="submit">Submit answer</button>
  </form>);
  const fields = screen.getAllByRole('textbox');

  expect(fields.map(field => field.getAttribute('enterkeyhint'))).toEqual(['next', 'next', 'next', 'done']);
  fields[0].focus();
  fireEvent.change(fields[0], { target: { value: 'a very long entered answer' } });
  expect(fields[0]).toHaveFocus();
  expect(fireEvent.keyDown(fields[0], { key: 'Enter', isComposing: true })).toBe(false);
  expect(fields[0]).toHaveFocus();
  fireEvent.keyDown(fields[0], { key: 'Enter' });
  expect(fields[1]).toHaveFocus();
  fields[3].focus();
  fireEvent.keyDown(fields[3], { key: 'Enter' });
  expect(fields[3]).not.toHaveFocus();
  expect(submitted).not.toHaveBeenCalled();
});

it('renders blanks as inline underline fields that keep the scripture rhythm', () => {
  render(<MissingWordsInput tokens={tokens} values={{ 2: 'averylongenteredanswerwithoutbreaks' }} disabled={false} onChange={vi.fn()}
    results={[{ index: 2, isCorrect: false, expected: 'averylongexpectedanswerwithoutbreaks' }]} />);

  const passage = screen.getByRole('group', { name: 'Passage with missing words' });
  expect(passage).toHaveClass('er-scripture');
  expect(passage).toHaveStyle({ minWidth: '0', width: '100%' });
  const field = screen.getByLabelText('Blank 1 of 4');
  expect(field).toHaveStyle({ background: 'transparent', font: 'inherit', borderBottom: '2px solid var(--er-coral)' });
  expect(field).toHaveAttribute('data-missing-word-slot', '');
  expect(screen.getByTestId('missing-words-summary')).toHaveTextContent('0 of 4 correct — review blank 1');
});
