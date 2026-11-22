import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShareEditor } from './ShareEditor';
import type { Configuration } from './composition';
import { defaultShareOptions, emptyShareHistory } from './share';

const config: Configuration = {
  bodyType: 'female',
  style: 'student-curls',
  hairColor: 'brown',
  attire: 'student',
  skin: 'light',
  eyes: 'brown',
  background: 'sunrise',
  slots: [null, null, null],
};

function renderEditor() {
  const onBrowseHonors = vi.fn();
  render(<ShareEditor
    config={config}
    profile={{ userName: 'new-pathfinder' }}
    collection={[]}
    history={emptyShareHistory}
    setHistory={() => {}}
    options={defaultShareOptions}
    setOptions={() => {}}
    onEdit={() => {}}
    onBrowseHonors={onBrowseHonors}
    onError={() => {}}
  />);
  return { onBrowseHonors };
}

it('shows a real empty state with a Browse Achievement patches action when no patch is selected', () => {
  const { onBrowseHonors } = renderEditor();
  expect(screen.getByRole('heading', { name: 'No patches yet' })).toBeInTheDocument();
  expect(screen.getByText('Earn Achievement patches in training to unlock them for your share card.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Browse Achievement patches' }));
  expect(onBrowseHonors).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Add a patch or select one on your card to resize, rotate or layer it.')).not.toBeInTheDocument();
});
