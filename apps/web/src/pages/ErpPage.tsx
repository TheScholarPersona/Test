import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { useCan } from '../auth/session';
import { Feedback, latest } from '../components/Feedback';
import { Empty, ErrorMessage, Panel, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';

type Direction = '' | 'IN' | 'OUT';
const TYPE_TEXT: Record<string, string> = {
  product: 'Artikel',
  'receiving-order': 'Avis',
  'outbound-order': 'Auslagerauftrag',
  'goods-receipt': 'Wareneingang',
  'goods-issue': 'Warenausgang',
  'stock-change': 'Bestandsänderung',
  'stock-snapshot': 'Bestandsabgleich',
};

/** ERP-Anbindung: Protokoll der Nachrichten, Fehler erneut anstoßen, Bestandsabgleich auslösen. */
export function ErpPage() {
  const can = useCan();
  const [direction, setDirection] = useState<Direction>('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const counts = useQuery({ queryKey: ['erp', 'counts'], queryFn: () => unwrap(api.GET('/v1/erp/counts')) });
  const messages = useQuery({
    queryKey: ['erp', 'messages', direction, onlyFailed],
    queryFn: () => unwrap(api.GET('/v1/erp/messages', { params: { query: { limit: 200, ...(direction ? { direction } : {}), ...(onlyFailed ? { state: 'FAILED' } : {}) } } })),
  });
  const retry = useAction((id: string) => unwrap(api.POST('/v1/erp/messages/{id}/retry', { params: { path: { id } } })), ['erp'], (_, m) => `Nachricht ${m.messageId.slice(0, 8)} erneut angestoßen: ${m.state}`);
  const snapshot = useAction(() => unwrap(api.POST('/v1/erp/stock-snapshots')), ['erp'], () => 'Bestandsabgleich zur Abholung bereitgestellt');
  const selectedMessage = messages.data?.items.find((m) => m.id === selected);
  const count = (d: string, s: string) => counts.data?.items.find((c) => c.direction === d && c.state === s)?.count ?? 0;

  return (
    <>
      <h1>ERP-Anbindung</h1>
      <ErrorMessage error={messages.error ?? counts.error} />
      <Panel
        title="Übersicht"
        actions={can('leitstand') ? <button onClick={() => snapshot.run(undefined)} disabled={snapshot.pending}>Bestandsabgleich senden</button> : undefined}
      >
        <Feedback message={latest(snapshot.message, retry.message)} />
        <div className="row" aria-label="ERP-Zahlen">
          <span className="badge ok">Eingang verarbeitet: {count('IN', 'PROCESSED')}</span>
          <span className={`badge ${count('IN', 'FAILED') ? 'bad' : 'neutral'}`}>Eingang fehlerhaft: {count('IN', 'FAILED')}</span>
          <span className="badge neutral">Ausgang offen: {count('OUT', 'PENDING') + count('OUT', 'IN_DELIVERY')}</span>
          <span className="badge ok">Ausgang zugestellt: {count('OUT', 'SENT')}</span>
          <span className={`badge ${count('OUT', 'FAILED') ? 'bad' : 'neutral'}`}>Ausgang fehlgeschlagen: {count('OUT', 'FAILED')}</span>
        </div>
      </Panel>
      <Panel
        title="Nachrichten (neueste zuerst)"
        actions={
          <div className="row">
            <label>Richtung
              <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                <option value="">alle</option>
                <option value="IN">Eingang (ERP → WMS)</option>
                <option value="OUT">Ausgang (WMS → ERP)</option>
              </select>
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> nur Fehler
            </label>
          </div>
        }
      >
        {messages.data?.items.length ? (
          <div className="table-wrap">
            <table aria-label="ERP-Nachrichten">
              <thead><tr><th>Zeit</th><th>Richtung</th><th>Art</th><th>Bezug</th><th>Zustand</th><th className="num">Versuche</th><th>Fehler</th><th /></tr></thead>
              <tbody>
                {messages.data.items.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => setSelected(m.id)}>
                    <td>{dateTime(m.createdAt)}</td>
                    <td>{m.direction === 'IN' ? 'Eingang' : 'Ausgang'}</td>
                    <td>{TYPE_TEXT[m.type] ?? m.type}{m.action && m.action !== 'create' && m.action !== 'upsert' ? ` (${m.action})` : ''}</td>
                    <td className="mono">{m.reference ?? '–'}</td>
                    <td><StateBadge state={m.state} /></td>
                    <td className="num">{m.attempts}</td>
                    <td className="muted">{m.lastError ?? ''}</td>
                    <td>
                      {m.state === 'FAILED' && can('leitstand') && (
                        <button
                          className="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            retry.run(m.id);
                          }}
                        >
                          Erneut
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine ERP-Nachrichten.</Empty>
        )}
      </Panel>
      {selectedMessage && (
        <Panel title={`Nachricht ${selectedMessage.messageId}`}>
          <div className="row" style={{ marginBottom: 8 }}>
            <StateBadge state={selectedMessage.state} />
            {selectedMessage.completedAt && <span className="muted">abgeschlossen {dateTime(selectedMessage.completedAt)}</span>}
            {selectedMessage.nextAttemptAt && selectedMessage.state === 'PENDING' && <span className="muted">nächster Versuch {dateTime(selectedMessage.nextAttemptAt)}</span>}
          </div>
          <pre className="mono" aria-label="Inhalt" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(selectedMessage.payload, null, 2)}</pre>
          {selectedMessage.result && <pre className="mono muted" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(selectedMessage.result, null, 2)}</pre>}
        </Panel>
      )}
    </>
  );
}
