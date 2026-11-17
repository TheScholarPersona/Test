import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback } from '../components/Feedback';
import { Empty, ErrorMessage, Panel, StateBadge, time } from '../components/ui';
import { useAction } from '../components/useAction';

type DeviceEventType = 'request' | 'arrived' | 'location-status' | 'error';

function DeviceEventForm() {
  const [type, setType] = useState<DeviceEventType>('request');
  const [plcCode, setPlcCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [trace, setTrace] = useState<string[] | null>(null);
  const send = useAction(
    async () => {
      const result = await unwrap(api.POST('/v1/flow/events', { body: { type, location: { plcCode }, ...(barcode ? { barcode } : {}), deviceId: 'leitstand', dryRun } }));
      setTrace([`Ergebnis: ${result.decision.outcome}${result.command ? ` → ${result.command.to.plcCode ?? result.command.to.locationId}` : ''}`, ...result.decision.trace]);
      return result;
    },
    ['flow'],
  );
  return (
    <Panel title="Geräte-Ereignis senden">
      <p className="muted">Wie eine Anlage: „TU steht an Platz“. Im Probelauf wird nur entschieden und begründet, nichts gebucht oder gesendet.</p>
      <Feedback message={send.message} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          send.run(undefined);
        }}
      >
        <label>
          Ereignis
          <select value={type} onChange={(e) => setType(e.target.value as DeviceEventType)}>
            <option value="request">request (Zielanfrage)</option>
            <option value="arrived">arrived (angekommen)</option>
            <option value="location-status">location-status</option>
            <option value="error">error (Störung)</option>
          </select>
        </label>
        <label>Anlagen-Code (plcCode)<input value={plcCode} onChange={(e) => setPlcCode(e.target.value)} required /></label>
        <label>TU-Barcode<input value={barcode} onChange={(e) => setBarcode(e.target.value)} /></label>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Probelauf
        </label>
        <button disabled={send.pending}>Senden</button>
      </form>
      {trace && (
        <ol className="trace" aria-label="Begründung">
          {trace.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      )}
    </Panel>
  );
}

export function FlowPage() {
  const [open, setOpen] = useState<string | null>(null);
  const routes = useQuery({ queryKey: ['flow', 'routes'], queryFn: () => unwrap(api.GET('/v1/flow/routes')) });
  const actions = useQuery({ queryKey: ['flow', 'actions'], queryFn: () => unwrap(api.GET('/v1/flow/actions')) });
  const decisions = useQuery({ queryKey: ['flow', 'decisions'], queryFn: () => unwrap(api.GET('/v1/flow/decisions', { params: { query: { limit: 50 } } })) });
  return (
    <>
      <h1>Materialfluss</h1>
      <ErrorMessage error={routes.error ?? actions.error ?? decisions.error} />
      <DeviceEventForm />
      <Panel title="Entscheidungen (neueste zuerst)">
        {decisions.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Zeit</th><th>Ereignis</th><th>TU</th><th>Platz</th><th>Route</th><th>Action</th><th>Ergebnis</th><th>nächster Platz</th></tr></thead>
              <tbody>
                {decisions.data.items.map((d) => (
                  <Fragment key={d.id}>
                    <tr className="clickable" onClick={() => setOpen(open === d.id ? null : d.id)}>
                      <td>{time(d.createdAt)}</td>
                      <td>{d.eventType}</td>
                      <td className="mono">{d.barcode ?? '–'}</td>
                      <td className="mono">{d.locationId}</td>
                      <td>{d.routeId ?? '–'}</td>
                      <td>{d.action ?? '–'}</td>
                      <td><StateBadge state={d.outcome} /></td>
                      <td className="mono">{d.next ?? '–'}</td>
                    </tr>
                    {open === d.id && (
                      <tr>
                        <td colSpan={8}>
                          <ol className="trace">{d.trace.map((line, i) => <li key={i}>{line}</li>)}</ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Noch keine Entscheidungen.</Empty>
        )}
      </Panel>
      <Panel title="Routen">
        {routes.data?.items.length ? (
          routes.data.items.map((r) => (
            <div key={r.routeId} style={{ marginBottom: 12 }}>
              <div className="row">
                <strong>{r.routeId}</strong>
                <span className={`badge ${r.enabled ? 'ok' : 'neutral'}`}>{r.enabled ? 'aktiv' : 'aus'}</span>
                <span className="muted">
                  {'location' in r.source ? r.source.location.plcCode ?? r.source.location.locationId : `Gruppe ${r.source.group}`} →{' '}
                  {'location' in r.target ? r.target.location.plcCode ?? r.target.location.locationId : `Gruppe ${r.target.group}`}
                </span>
              </div>
              <div className="muted mono">
                {r.steps.map((s) => `${s.from.plcCode ?? s.from.locationId} → ${s.next.plcCode ?? s.next.locationId}${s.unitType ? ` [${s.unitType}]` : ''}`).join(' · ') || 'keine Schritte'}
              </div>
            </div>
          ))
        ) : (
          <Empty>Keine Routen.</Empty>
        )}
      </Panel>
      <Panel title="Action-Matrix">
        {actions.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Ereignis</th><th>Route</th><th>Ort</th><th>Programm</th></tr></thead>
              <tbody>
                {actions.data.items.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td>{a.eventType}</td>
                    <td>{a.routeId ?? 'beliebig'}</td>
                    <td>{a.place ? ('location' in a.place ? a.place.location.plcCode ?? a.place.location.locationId : `Gruppe ${a.place.group}`) : 'überall'}</td>
                    <td className="mono">{a.program}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Actions.</Empty>
        )}
      </Panel>
    </>
  );
}
