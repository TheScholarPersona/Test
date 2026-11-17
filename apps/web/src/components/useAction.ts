import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../api/client';
import type { FeedbackMessage } from './Feedback';

/**
 * Aktion mit Rückmeldung: führt `fn` aus, zeigt Erfolg oder den fachlichen
 * Fehler der API und lädt die genannten Abfragen neu.
 */
export function useAction<A>(fn: (arg: A) => Promise<unknown>, invalidate: string[], success?: (arg: A) => string) {
  const client = useQueryClient();
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: (_data, arg) => {
      setMessage(success ? { kind: 'success', text: success(arg), at: Date.now() } : null);
      for (const key of invalidate) void client.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => setMessage({ kind: 'error', text: describeError(error), at: Date.now() }),
  });
  return { run: (arg: A) => mutation.mutate(arg), pending: mutation.isPending, message, clear: () => setMessage(null) };
}
