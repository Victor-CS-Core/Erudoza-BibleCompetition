import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VerseBuilderInput } from './VerseBuilderInput';
it('appends a chosen token directly rather than moving it repeatedly', () => {
  const changed = vi.fn();
  render(<VerseBuilderInput tokens={[{index:0,display:'one'},{index:1,display:'one'}]}
    selected={[]} onChange={changed} disabled={false} />);
  fireEvent.click(screen.getAllByRole('button', { name:'Add one' })[1]);
  expect(changed).toHaveBeenCalledWith([1]);
});
it('builds a 47-word verse with one append per chunk and maintains focus for undo and clear', () => {
  const words = Array.from({length:47},(_,i)=>`word${i}`);
  const tokens = Array.from({length:12},(_,index)=>({index,display:words.slice(index*4,index*4+4).join(' ')}));
  const changed = vi.fn();
  function Harness(){const [selected,setSelected]=useState<number[]>([]);return <VerseBuilderInput tokens={tokens} selected={selected} onChange={ids=>{changed(ids);setSelected(ids);}} disabled={false}/>;}
  render(<Harness/>);
  for(const token of tokens)fireEvent.click(screen.getByRole('button',{name:`Add ${token.display}`}));
  expect(changed).toHaveBeenCalledTimes(12);
  expect(screen.getByRole('button',{name:'Undo last phrase'})).toHaveFocus();
  expect(screen.getByLabelText('Your verse')).toHaveTextContent(words.join(' '));
  expect(screen.queryByRole('button',{name:/Move phrase/})).not.toBeInTheDocument();
  const undo=screen.getByRole('button',{name:'Undo last phrase'});undo.focus();fireEvent.click(undo);expect(undo).toHaveFocus();
  const clear=screen.getByRole('button',{name:'Clear verse'});clear.focus();fireEvent.click(clear);
  expect(screen.getByRole('button',{name:`Add ${tokens[0].display}`})).toHaveFocus();
  expect(changed).toHaveBeenLastCalledWith([]);
});
it('marks each submitted chunk by placement once the checked verse text is provided',()=>{
  const tokens=[{index:0,display:'In the beginning'},{index:1,display:'God created'},{index:2,display:'the heaven'},{index:3,display:'and the earth'}];
  // Submitted: chunk 1 in the right place, chunk 3 before chunk 2 (both in
  // the verse, wrong positions), plus a chunk that is not in the verse.
  const tray=[...tokens,{index:4,display:'made all things'}];
  render(<VerseBuilderInput tokens={tray} selected={[0,2,1,4]} onChange={vi.fn()} disabled feedbackSourceText="In the beginning God created the heaven and the earth"/>);
  const items=screen.getAllByTestId('chunk-placement');
  expect(items.map(item=>item.getAttribute('data-placement'))).toEqual(['correct-position','wrong-position','wrong-position','not-in-verse']);
  expect(items[0]).toHaveTextContent('Right place');
  expect(items[0]).toHaveTextContent('In the beginning');
  expect(items[1]).toHaveTextContent('In the verse, but in the wrong place');
  expect(items[3]).toHaveTextContent('Not in this verse');
  expect(items[3]).toHaveTextContent('made all things');
});
it('shows no placement ticks before the answer is checked',()=>{
  render(<VerseBuilderInput tokens={[{index:0,display:'one'},{index:1,display:'two'}]} selected={[1,0]} onChange={vi.fn()} disabled={false}/>);
  expect(screen.queryByTestId('chunk-placements')).not.toBeInTheDocument();
});
it('locks every answer mutation while a submission is pending',()=>{
  const changed=vi.fn();render(<VerseBuilderInput tokens={[{index:7,display:'one'},{index:8,display:'two'}]} selected={[7]} onChange={changed} disabled/>);
  for(const button of screen.getAllByRole('button')){expect(button).toBeDisabled();fireEvent.click(button);}
  expect(changed).not.toHaveBeenCalled();
});
