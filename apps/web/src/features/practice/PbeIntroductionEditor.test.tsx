import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbeIntroductionEditor } from './PbeIntroductionEditor';
it('prepares coordinate-free introduction text and deliberately assigns members',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PbeIntroductionEditor org="org" season="season" books={['GEN']} members={[{id:'member',displayName:'Ada'}]} introductions={[]} run={save}/>);
 expect(screen.queryByLabelText(/chapter|verse/i)).toBeNull();fireEvent.click(screen.getByText('Prepare a book introduction'));
 fireEvent.change(screen.getByLabelText('Introduction book'),{target:{value:'GEN'}});
 for(const label of ['Source edition','Introduction title','Introduction citation','Introduction text'])fireEvent.change(screen.getByLabelText(label),{target:{value:'Synthetic source'}});
 fireEvent.click(screen.getByRole('button',{name:'Save introduction draft'}));expect(save).toHaveBeenCalled();
});
