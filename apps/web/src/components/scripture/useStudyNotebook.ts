import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { NotebookEntryInput } from '../../api/types';

export function useStudyNotebook(orgId: string, userId: string) {
  const client = useQueryClient(), key = ['scripture-notebook', orgId, userId];
  const query = useQuery({ queryKey: key, queryFn: () => api.notebook(orgId), staleTime: Infinity, refetchOnWindowFocus: false });
  const lock = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const ready = !!query.data && !query.isError && !pending && !conflict && !query.isFetching;
  async function mutate(id: string, entry?: NotebookEntryInput) {
    if (!ready || lock.current) return false;
    lock.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = entry ? await api.saveNotebookEntry(orgId, id, query.data!.version, entry) : await api.deleteNotebookEntry(orgId, id, query.data!.version);
      await client.cancelQueries({ queryKey: key }); client.setQueryData(key, result);
      setMessage(entry ? 'Saved to your notebook.' : 'Removed from your notebook.'); return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your changes could not be saved. Try again.');
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      return false;
    } finally { lock.current = false; setPending(false); }
  }
  async function reload() {
    const result = await query.refetch();
    if (!result.isError) { setConflict(false); setError(''); setMessage('Notebook reloaded. Review your changes before saving again.'); }
  }
  return { query, pending, ready, error, conflict, message, mutate, reload };
}
