import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback, latest } from '../components/Feedback';
import { Empty, ErrorMessage, Panel, StateBadge, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';
import { useCan } from '../auth/session';

type ToAction = 'start' | 'finish' | 'cancel' | 'resume';
type MvAction = 'start' | 'complete' | 'cancel';

export function TransportPage() {
  const can = useCan();
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

  // Bewegungsgruppen: Auswahl in der Bewegungsliste, Bediener für neue Gruppen und Zuteilung.
  const [selected, setSelected] = useState<string[]>([]);
  const [operator, setOperator] = useState('');
  const groups = useQuery({
    queryKey: ['movement-groups'],
    queryFn: () => unwrap(api.GET('/v1/movement-groups', { params: { query: { state: 'OPEN,IN_PROGRESS', limit: 100 } } })),
  });
  const createGroup = useAction(
    (movements: string[]) => unwrap(api.POST('/v1/movement-groups', { body: { movements, ...(operator ? { assignedTo: operator } : {}) } })),
    ['movement-groups', 'movements'],
    (movements) => `Bewegungsgruppe mit ${movements.length} Bewegungen gebildet`,
  );
  const groupAction = useAction(
    ({ number, action }: { number: string; action: 'start' | 'release' | 'assign' }) => {
      const p = { params: { path: { number } } };
      if (action === 'start') return unwrap(api.POST('/v1/movement-groups/{number}/start', { ...p, body: {} }));
      if (action === 'release') return unwrap(api.POST('/v1/movement-groups/{number}/release', p));
      return unwrap(api.POST('/v1/movement-groups/{number}/assign', { ...p, body: { assignedTo: operator || null } }));
    },
    ['movement-groups', 'movements'],
    ({ number, action }) => `${number}: ${{ start: 'begonnen', release: 'zurückgegeben', assign: operator ? `zugeteilt an ${operator}` : 'Zuteilung aufgehoben' }[action]}`,
  );
  const toggle = (number: string) => setSelected((s) => (s.includes(number) ? s.filter((n) => n !== number) : [...s, number]));

  return (
    <>
      <h1>Transport</h1>
      <ErrorMessage error={orders.error ?? movements.error} />
      <Feedback message={latest(toAction.message, mvAction.message, startPending.message, createGroup.message, groupAction.message)} />
      <Panel title="Transportaufträge (Anlage, offen)" actions={can('leitstand', 'anlage') && <button className="secondary" onClick={() => startPending.run(undefined)}>Wartende starten</button>}>
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
                        .filter((a) => o.allowedActions.includes(a) && can('leitstand', 'anlage'))
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
      <Panel title="Bewegungsgruppen (offen und in Arbeit)">
        <div className="toolbar">
          <label>Bediener<input value={operator} onChange={(e) => setOperator(e.target.value.trim())} placeholder="z. B. stapler-7" /></label>
          {can('leitstand') && (
            <button
              disabled={selected.length === 0 || createGroup.pending}
              onClick={() => {
                createGroup.run(selected);
                setSelected([]);
              }}
            >
              Gruppe bilden ({selected.length})
            </button>
          )}
        </div>
        {groups.data?.items.length ? (
          <div className="table-wrap">
            <table aria-label="Bewegungsgruppen">
              <thead><tr><th>Gruppe</th><th>Bediener</th><th>Zustand</th><th>Bewegungen</th><th /></tr></thead>
              <tbody>
                {groups.data.items.map((g) => (
                  <tr key={g.number}>
                    <td className="mono">{g.number}{g.description ? <div className="muted">{g.description}</div> : null}</td>
                    <td>{g.assignedTo ?? '–'}</td>
                    <td><StateBadge state={g.state} /></td>
                    <td>{g.counts.open} offen · {g.counts.inProgress} in Arbeit · {g.counts.done} erledigt</td>
                    <td className="row">
                      {can('leitstand') && <button className="secondary" onClick={() => groupAction.run({ number: g.number, action: 'assign' })}>Zuteilen</button>}
                      {can('lager', 'leitstand') && g.counts.open > 0 && <button className="secondary" onClick={() => groupAction.run({ number: g.number, action: 'start' })}>Beginnen</button>}
                      {can('lager', 'leitstand') && g.counts.inProgress > 0 && <button className="secondary" onClick={() => groupAction.run({ number: g.number, action: 'release' })}>Zurückgeben</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine offenen Bewegungsgruppen. Bewegungen unten auswählen und „Gruppe bilden“.</Empty>
        )}
      </Panel>
      <Panel title="Lagerbewegungen (Bediener, offen – dringendste zuerst)">
        {movements.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>Nummer</th><th>TU</th><th>Art</th><th>Zustand</th><th>Gruppe</th><th>von</th><th>nach</th><th>angelegt</th><th /></tr></thead>
              <tbody>
                {movements.data.items.map((m) => (
                  <tr key={m.number}>
                    <td>
                      {!m.groupNumber && can('leitstand') && (
                        <input type="checkbox" aria-label={`${m.number} auswählen`} checked={selected.includes(m.number)} onChange={() => toggle(m.number)} />
                      )}
                    </td>
                    <td className="mono">{m.number}</td>
                    <td className="mono">{m.barcode}</td>
                    <td>{m.type}</td>
                    <td><StateBadge state={m.state} /></td>
                    <td className="mono">{m.groupNumber ?? '–'}{m.assignedTo ? <div className="muted">{m.assignedTo}</div> : null}</td>
                    <td className="mono">{m.source.locationId}</td>
                    <td className="mono">{m.target?.locationId ?? '–'}</td>
                    <td>{dateTime(m.createdAt)}</td>
                    <td className="row">
                      {(['start', 'complete', 'cancel'] as const)
                        .filter((a) => m.allowedActions.includes(a) && (a === 'cancel' ? can('leitstand') : can('lager', 'leitstand')))
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
