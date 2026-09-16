import type {MouseEvent} from 'react';
import {Button} from '../../../components/ui';

export type PreviewMode = 'still' | 'animated';

/**
 * Shared 2D/3D segmented toggle for the character preview, used inline and in
 * the fullscreen preview. stopPropagation keeps the tap-to-fullscreen stage
 * from opening when a toggle button is pressed.
 */
export function PreviewModeToggle({mode, onChange}: {mode: PreviewMode; onChange: (mode: PreviewMode) => void}) {
  const pick = (next: PreviewMode) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onChange(next);
  };
  return <div className="preview-mode-toggle" role="group" aria-label="Preview style">
    <Button variant={mode === 'still' ? 'primary' : 'secondary'} size="compact" aria-pressed={mode === 'still'} onClick={pick('still')}>2D</Button>
    <Button variant={mode === 'animated' ? 'primary' : 'secondary'} size="compact" aria-pressed={mode === 'animated'} onClick={pick('animated')}>3D</Button>
  </div>;
}
