import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, unwrap } from '../api/client';
import { useCan } from '../auth/session';
import { Feedback } from '../components/Feedback';
import { LiveFeed } from '../components/LiveFeed';
import { Empty, ErrorMessage, Panel, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';
import { useLive } from '../live/events';

/** Offene Fehlermeldungen an TUs und Plätze mit Störung laut Anlage. */
function FaultsPanel() {
  const can = useCan();
  const errors = useQuery({ queryKey: ['units', 'errors'], queryFn: () => unwrap(api.GET('/v1/transport-unit-errors', { params: { query: { state: 'open', limit: 200 } } })) });
  const locations = useQuery({ queryKey: ['locations', 'faults'], queryFn: () => unwrap(api.GET('/v1/locations', { params: { query: { limit: 10_000 } } })) });
  const resolve = useAction(
    (e: { barcode: string; id: string }) =>
      unwrap(api.POST('/v1/transport-units/{barcode}/errors/{errorId}/resolve', { params: { path: { barcode: e.barcode, errorId: e.id } }, body: { resolution: 'Leitstand' } })),
    ['units'],
    (e) => `Fehlermeldung an ${e.barcode} erledigt`,
  );
  const faulty = (locations.data?.items ?? []).filter((l) => l.plc.state !== 0);
  const open = errors.data?.items ?? [];
  return (
    <Panel title="Störungen">
      <ErrorMessage error={errors.error ?? locations.error} />
      <Feedback message={resolve.message} />
      {open.length === 0 && faulty.length === 0 ? (
        <Empty>Keine offenen Störungen.</Empty>
      ) : (
        <div className="table-wrap">
          <table aria-label="Störungen">
            <thead><tr><th>Wo</th><th>Code</th><th>Meldung</th><th>Gemeldet</th><th /></tr></thead>
            <tbody>
              {faulty.map((l) => (
                <tr key={l.id}>
                  <td>Platz <span className="mono">{l.plcCode ?? l.locationId}</span></td>
                  <td><span className="badge bad">Anlage {l.plc.state}</span></td>
                  <td>{l.plc.text ?? '–'}</td>
                  <td>{dateTime(l.plc.changedAt)}</td>
                  <td />
                </tr>
              ))}
              {open.map((e) => (
                <tr key={e.id}>
                  <td>TU <span className="mono">{e.barcode}</span>{e.locationId ? <span className="muted"> auf {e.locationId}</span> : null}</td>
                  <td><span className="badge warn">{e.code}</span></td>
                  <td>{e.message ?? '–'}<div className="muted">{e.reportedBy ?? ''}</div></td>
                  <td>{dateTime(e.reportedAt)}</td>
                  <td>{can('lager', 'leitstand') && <button className="secondary" onClick={() => resolve.run({ barcode: e.barcode, id: e.id })}>Erledigt</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Tile({ label, value, to }: { label: string; value: number | string | undefined; to: string }) {
  return (
    <Link to={to} className="tile" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '…'}</div>
    </Link>
  );
}

export function OverviewPage() {
  const { connected } = useLive();
  const health = useQuery({ queryKey: ['overview', 'health'], queryFn: () => unwrap(api.GET('/health')), refetchInterval: 15_000 });
  const counts = useQuery({
    queryKey: ['overview', 'counts'],
    queryFn: async () => {
      const [stock, receiving, outbound, transport, movements, locations] = await Promise.all([
        unwrap(api.GET('/v1/stock/summary', { params: { query: { limit: 1000 } } })),
        unwrap(api.GET('/v1/receiving-orders', { params: { query: { limit: 1000 } } })),
        unwrap(api.GET('/v1/outbound-orders', { params: { query: { limit: 1000 } } })),
        unwrap(api.GET('/v1/transport-orders', { params: { query: { state: 'INITIALIZED,STARTED,INTERRUPTED', limit: 1000 } } })),
        unwrap(api.GET('/v1/movements', { params: { query: { state: 'OPEN,IN_PROGRESS', limit: 1000 } } })),
        unwrap(api.GET('/v1/locations', { params: { query: { limit: 10_000 } } })),
      ]);
      return {
        products: stock.total,
        receivingOpen: receiving.items.filter((o) => o.state === 'OPEN' || o.state === 'IN_PROGRESS').length,
        outboundOpen: outbound.items.filter((o) => o.state !== 'COMPLETED' && o.state !== 'CANCELLED').length,
        transport: transport.total,
        movements: movements.total,
        locations: locations.total,
      };
    },
  });
  const c = counts.data;
  return (
    <>
      <h1>Übersicht</h1>
      <ErrorMessage error={counts.error ?? health.error} />
      <div className="grid">
        <Tile label="Produkte mit Bestand" value={c?.products} to="/bestand" />
        <Tile label="Offene Wareneingänge" value={c?.receivingOpen} to="/wareneingang" />
        <Tile label="Offene Auslageraufträge" value={c?.outboundOpen} to="/auslagerung" />
        <Tile label="Laufende Transportaufträge" value={c?.transport} to="/transport" />
        <Tile label="Offene Lagerbewegungen" value={c?.movements} to="/transport" />
        <Tile label="Lagerplätze" value={c?.locations} to="/lagerplaetze" />
      </div>
      <Panel title="System">
        <div className="row">
          <span>
            API <span className={`badge ${health.data?.status === 'ok' ? 'ok' : 'bad'}`}>{health.data?.status ?? '…'}</span>
          </span>
          <span>
            Datenbank <span className={`badge ${health.data?.checks.database === 'up' ? 'ok' : 'bad'}`}>{health.data?.checks.database ?? '…'}</span>
          </span>
          <span>
            MQTT <span className={`badge ${health.data?.checks.mqtt === 'up' ? 'ok' : 'bad'}`}>{health.data?.checks.mqtt ?? '…'}</span>
          </span>
          <span>
            Live-Ereignisse <span className={`badge ${connected ? 'ok' : 'bad'}`}>{connected ? 'verbunden' : 'getrennt'}</span>
          </span>
        </div>
      </Panel>
      <FaultsPanel />
      <Panel title="Letzte Ereignisse" actions={<Link to="/ereignisse">alle</Link>}>
        <LiveFeed limit={12} />
      </Panel>
    </>
  );
}
