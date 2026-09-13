import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StudyWorkspace } from './StudyWorkspace';
import { api } from '../../api/client';
import type { StudyNotebook, NotebookEntryInput } from '../../api/types';
vi.mock('../../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../../api/client')>(), api: { notebook: vi.fn(), saveNotebookEntry: vi.fn(), deleteNotebookEntry: vi.fn() } }));
const book = { contentPackId: 'pack', bookKey: 'PSA', name: 'Psalms', verseCount: 1, chapters: [{ number: 23, verses: [1] }] };
const units = [{ id: 'source', bookKey: 'PSA', chapter: 23, verse: 1, ordinal: 1, citation: 'Psalms 23:1', canonicalText: 'The Lord is my shepherd; I shall not want.' }];
let saved: StudyNotebook;
beforeEach(() => {
  vi.clearAllMocks(); saved = { version: 0, entries: [] }; vi.mocked(api.notebook).mockImplementation(async () => saved);
  vi.mocked(api.saveNotebookEntry).mockImplementation(async (_org, id, version, entry: NotebookEntryInput) => {
    if (version !== saved.version) throw new Error('Version mismatch');
    saved = { version: version + 1, entries: [...saved.entries.filter(e => e.id !== id), { ...entry, id, bookName: 'Psalms', citation: 'Psalms 23:1', quote: entry.kind === 'bookmark' ? '' : units[0].canonicalText.slice(entry.startOffset!, entry.endOffset!), updatedAtUtc: '2026-09-13T00:00:00Z' }] }; return saved;
  });
});
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudyWorkspace orgId="org" userId="user" book={book} chapter={23} units={units} navigation={<span>Chapter navigation</span>} onNavigate={vi.fn()} /></QueryClientProvider>); }
it('saves an exact whole-verse highlight, filters the notebook and hides/reveals words', async () => {
  mount(); await screen.findByText('Your notebook is empty.'); fireEvent.click(screen.getByRole('button', { name: 'Select verse 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Promises' }));
  await screen.findByText('Saved to your notebook.');
  expect(document.querySelector('[data-verse-text] mark')).toHaveTextContent('The Lord is my shepherd; I shall not want.');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' })); expect(screen.queryByRole('button', { name: 'Open Psalms 23:1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hide words' })); expect(screen.getByLabelText('Hidden words')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reveal words' })); expect(document.querySelector('[data-verse-text]')).toHaveTextContent('The Lord is my shepherd; I shall not want.');
});
it('keeps a note draft on failed save, retries and permits editing saved text', async () => {
  mount(); await screen.findByText('Your notebook is empty.'); fireEvent.click(screen.getByRole('button', { name: 'Select verse 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Note' })); fireEvent.change(screen.getByRole('textbox', { name: /Your note/ }), { target: { value: 'Remember the Shepherd.' } });
  vi.mocked(api.saveNotebookEntry).mockRejectedValueOnce(new Error('Connection unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Save note' })); await screen.findByText('Connection unavailable');
  expect(screen.getByRole('textbox', { name: /Your note/ })).toHaveValue('Remember the Shepherd.');
  fireEvent.click(screen.getByRole('button', { name: 'Save note' })); await screen.findByText('Remember the Shepherd.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit note' })); fireEvent.change(screen.getByRole('textbox', { name: /Your note/ }), { target: { value: '<b>Plain text note</b>' } });
  expect(screen.getByRole('button', { name: 'Delete note for Psalms 23:1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save note' })); await waitFor(() => expect(screen.queryByRole('textbox', { name: /Your note/ })).not.toBeInTheDocument()); expect(screen.getByText('<b>Plain text note</b>')).toBeInTheDocument(); expect(saved.entries).toHaveLength(1);
});
it('jumps to the selected verse with keyboard focus while Focus mode is active', async () => {
  mount(); await screen.findByText('Your notebook is empty.'); fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Verse' }), { target: { value: 'source' } });
  expect(screen.getByRole('button', { name: 'Select verse 1' })).toHaveFocus();
  const go = screen.getByRole('button', { name: 'Go to verse' }); go.focus(); fireEvent.click(go);
  expect(screen.getByRole('button', { name: 'Select verse 1' })).toHaveFocus();
});
it('bookmarks the chapter and restores the notebook after Focus mode', async () => {
  mount(); await screen.findByText('Your notebook is empty.'); fireEvent.click(screen.getByRole('button', { name: 'Bookmark chapter' }));
  await screen.findByRole('button', { name: 'Remove chapter bookmark' }); fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }));
  expect(within(screen.getByRole('complementary', { name: 'My study notebook' })).getByRole('button', { name: /Open Psalms/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Focus' })); expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exit focus' })); expect(screen.getByRole('complementary')).toBeInTheDocument();
});
