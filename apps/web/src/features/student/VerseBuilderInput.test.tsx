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
it('locks every answer mutation while a submission is pending',()=>{
  const changed=vi.fn();render(<VerseBuilderInput tokens={[{index:7,display:'one'},{index:8,display:'two'}]} selected={[7]} onChange={changed} disabled/>);
  for(const button of screen.getAllByRole('button')){expect(button).toBeDisabled();fireEvent.click(button);}
  expect(changed).not.toHaveBeenCalled();
});
