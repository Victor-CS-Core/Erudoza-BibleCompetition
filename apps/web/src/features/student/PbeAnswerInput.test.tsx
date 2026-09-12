import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbeAnswerInput } from './PbeAnswerInput';
it('provides the requested answer fields without revealing options',()=>{
 const changed=vi.fn();render(<PbeAnswerInput partPoints={[1,1]} answers={['','']} onChange={changed} disabled={false}/>);
 expect(screen.getAllByRole('textbox')).toHaveLength(2);fireEvent.change(screen.getByLabelText('Answer 1'),{target:{value:'Alpha'}});expect(changed).toHaveBeenCalledWith(['Alpha','']);expect(screen.queryByRole('radio')).toBeNull();
});
