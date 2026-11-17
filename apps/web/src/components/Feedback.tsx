/** Rückmeldung einer Aktion; `at` ist der Zeitpunkt, zu dem sie entstand. */
export type FeedbackMessage = { kind: 'success' | 'error'; text: string; at?: number };

export function Feedback({ message }: { message: FeedbackMessage | null }) {
  if (!message) return null;
  return (
    <div className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </div>
  );
}

/** Die jüngste von mehreren Rückmeldungen – eine Seite mit mehreren Aktionen zeigt immer die zuletzt ausgeführte. */
export function latest(...messages: (FeedbackMessage | null)[]): FeedbackMessage | null {
  return messages.reduce<FeedbackMessage | null>((newest, m) => (m && (!newest || (m.at ?? 0) >= (newest.at ?? 0)) ? m : newest), null);
}
