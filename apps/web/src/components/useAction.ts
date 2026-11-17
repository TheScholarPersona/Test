import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../api/client';
import type { FeedbackMessage } from './Feedback';

/**
 * Aktion mit Rückmeldung: führt `fn` aus, zeigt Erfolg oder den fachlichen
 * Fehler der API und lädt die genannten Abfragen neu.
 */
export function useAction<A, P extends Promise<unknown> = Promise<unknown>>(fn: (arg: A) => P, invalidate: string[], success?: (arg: A, data: Awaited<P>) => string) {
  const client = useQueryClient();
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: (data, arg) => {
      setMessage(success ? { kind: 'success', text: success(arg, data as Awaited<P>), at: Date.now() } : null);
      for (const key of invalidate) void client.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => setMessage({ kind: 'error', text: describeError(error), at: Date.now() }),
  });
  return { run: (arg: A) => mutation.mutate(arg), pending: mutation.isPending, message, clear: () => setMessage(null) };
}
