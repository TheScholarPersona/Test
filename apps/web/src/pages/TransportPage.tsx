import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';
import { Feedback } from '../components/Feedback';
import { Empty, ErrorMessage, Panel, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';

type ToAction = 'start' | 'finish' | 'cancel' | 'resume';
type MvAction = 'start' | 'complete' | 'cancel';

export function TransportPage() {
  const orders = useQuery({
    queryKey: ['transport-orders'],
    queryFn: () => unwrap(api.GET('/v1/transport-orders', { params: { query: { state: 'INITIALIZED,STARTED,INTERRUPTED', limit: 200 } } })),
  });
  const movements = useQuery({
    queryKey: ['movements'],
    queryFn: () => unwrap(api.GET('/v1/movements', { params: { query: { state: 'OPEN,IN_PROGRESS', limit: 200 } } })),
  });
  const toAction = useAction(
    ({ number, action }: { number: string; action: ToAction }) => {
      const p = { params: { path: { number } } };
      if (action === 'start') return unwrap(api.POST('/v1/transport-orders/{number}/start', p));
      if (action === 'resume') return unwrap(api.POST('/v1/transport-orders/{number}/resume', p));
      if (action === 'finish') return unwrap(api.POST('/v1/transport-orders/{number}/finish', { ...p, body: {} }));
      return unwrap(api.POST('/v1/transport-orders/{number}/cancel', { ...p, body: { reason: 'Leitstand' } }));
    },
    ['transport-orders', 'units'],
    ({ number, action }) => `${number}: ${action} ausgeführt`,
  );
  const mvAction = useAction(
    ({ number, action }: { number: string; action: MvAction }) => {
      const p = { params: { path: { number } } };
      if (action === 'start') return unwrap(api.POST('/v1/movements/{number}/start', { ...p, body: { assignedTo: 'leitstand' } }));
      if (action === 'complete') return unwrap(api.POST('/v1/movements/{number}/complete', { ...p, body: {} }));
      return unwrap(api.POST('/v1/movements/{number}/cancel', { ...p, body: { reason: 'Leitstand' } }));
    },
    ['movements', 'units'],
    ({ number, action }) => `${number}: ${action} ausgeführt`,
  );
  const startPending = useAction(() => unwrap(api.POST('/v1/transport-orders/start-pending')), ['transport-orders'], () => 'Wartende Aufträge geprüft');

  return (
    <>
      <h1>Transport</h1>
      <ErrorMessage error={orders.error ?? movements.error} />
      <Feedback message={toAction.message ?? mvAction.message ?? startPending.message} />
      <Panel title="Transportaufträge (Anlage, offen)" actions={<button className="secondary" onClick={() => startPending.run(undefined)}>Wartende starten</button>}>
        {orders.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nummer</th><th>TU</th><th>Zustand</th><th>Priorität</th><th>von</th><th>nach</th><th>Problem</th><th /></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.number}>
                    <td className="mono">{o.number}</td>
                    <td className="mono">{o.barcode}</td>
                    <td><StateBadge state={o.state} /></td>
                    <td>{o.priority}</td>
                    <td className="mono">{o.source.locationId}</td>
                    <td className="mono">{o.target?.locationId ?? `Gruppe ${o.targetGroup}`}</td>
                    <td className="muted">{o.problem ? `${o.problem.code}: ${o.problem.message}` : '–'}</td>
                    <td className="row">
                      {(['start', 'resume', 'finish', 'cancel'] as const)
                        .filter((a) => o.allowedActions.includes(a))
                        .map((a) => (
                          <button key={a} className={a === 'cancel' ? 'danger' : 'secondary'} onClick={() => toAction.run({ number: o.number, action: a })}>
                            {{ start: 'Starten', resume: 'Fortsetzen', finish: 'Abschließen', cancel: 'Stornieren' }[a]}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine offenen Transportaufträge.</Empty>
        )}
      </Panel>
      <Panel title="Lagerbewegungen (Bediener, offen – dringendste zuerst)">
        {movements.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nummer</th><th>TU</th><th>Art</th><th>Zustand</th><th>von</th><th>nach</th><th>angelegt</th><th /></tr></thead>
              <tbody>
                {movements.data.items.map((m) => (
                  <tr key={m.number}>
                    <td className="mono">{m.number}</td>
                    <td className="mono">{m.barcode}</td>
                    <td>{m.type}</td>
                    <td><StateBadge state={m.state} /></td>
                    <td className="mono">{m.source.locationId}</td>
                    <td className="mono">{m.target?.locationId ?? '–'}</td>
                    <td>{dateTime(m.createdAt)}</td>
                    <td className="row">
                      {(['start', 'complete', 'cancel'] as const)
                        .filter((a) => m.allowedActions.includes(a))
                        .map((a) => (
                          <button key={a} className={a === 'cancel' ? 'danger' : 'secondary'} onClick={() => mvAction.run({ number: m.number, action: a })}>
                            {{ start: 'Beginnen', complete: 'Abschließen', cancel: 'Stornieren' }[a]}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine offenen Lagerbewegungen.</Empty>
        )}
      </Panel>
    </>
  );
}
