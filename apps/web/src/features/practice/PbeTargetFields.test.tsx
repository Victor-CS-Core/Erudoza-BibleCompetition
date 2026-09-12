import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PbeTargetFields } from './PbeTargetFields';
it('requires a declared learning target and exposes its skill',()=>{const choose=vi.fn();render(<PbeTargetFields targets={[{id:'a',label:'Opening words',skill:'ExactWords'}]} selectedTargetId={null} onSelect={choose}/>);expect(screen.getByLabelText('Learning target')).toBeRequired();fireEvent.change(screen.getByLabelText('Learning target'),{target:{value:'a'}});expect(choose).toHaveBeenCalledWith('a');expect(screen.getByText('Opening words · ExactWords')).toBeVisible();});
