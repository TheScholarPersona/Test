export function Feedback({ message }: { message: { kind: 'success' | 'error'; text: string } | null }) {
  if (!message) return null;
  return (
    <div className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </div>
  );
}
