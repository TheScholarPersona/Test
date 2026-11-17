import type { ReactNode } from 'react';
import { describeError } from '../api/client';

/** Zustandsanzeige mit fester Farbzuordnung. */
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral' | ''> = {
  COMPLETED: 'ok', FINISHED: 'ok', PICKED: 'ok', DONE: 'ok', CLOSED: 'ok', AVAILABLE: 'ok', ACTIVE: 'ok', COMMAND: 'ok',
  PARTIALLY_COMPLETED: 'warn', PARTIALLY_ALLOCATED: 'warn', SHORT: 'warn', INTERRUPTED: 'warn', QUALITY_CHECK: 'warn', COUNTED: 'warn', NO_NEXT_STEP: 'warn', NO_ACTION: 'warn',
  CANCELLED: 'neutral', CANCELED: 'neutral', ARCHIVED: 'neutral', DRAFT: 'neutral',
  ONFAILURE: 'bad', BLOCKED: 'bad', FAILED: 'bad',
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${TONE[state] ?? ''}`}>{state}</span>;
}

export function Quantity({ q }: { q: { amount: string; unit: string } | null | undefined }) {
  if (!q) return <span className="muted">–</span>;
  return (
    <span className="mono">
      {q.amount} {q.unit}
    </span>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="message error" role="alert">{describeError(error)}</div>;
}

export function Panel({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

export const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('de-DE') : '–');
export const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('de-DE') : '–');

/** Link auf ein PDF-Dokument der API; öffnet im neuen Tab (Anmeldung per Sitzungs-Cookie). */
export function PdfLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="button secondary" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
