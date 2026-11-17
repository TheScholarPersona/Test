import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { Feedback, latest } from '../components/Feedback';
import { Empty, ErrorMessage, Panel } from '../components/ui';
import { useAction } from '../components/useAction';
import { useCan } from '../auth/session';

type Lock = { own: boolean; blocked: boolean; blockedBy: { kind: string; name: string } | null };

function LockBadge({ lock, label }: { lock: Lock; label: string }) {
  if (!lock.blocked) return <span className="badge ok">{label} frei</span>;
  return (
    <span className="badge bad" title={lock.own ? 'eigene Sperre' : `geerbt von ${lock.blockedBy?.name}`}>
      {label} gesperrt{lock.own ? '' : ` (${lock.blockedBy?.name})`}
    </span>
  );
}

export function LocationsPage() {
  const canLock = useCan()('leitstand');
  const [group, setGroup] = useState('');
  const groups = useQuery({ queryKey: ['locations', 'groups'], queryFn: () => unwrap(api.GET('/v1/location-groups')) });
  const locations = useQuery({
    queryKey: ['locations', 'list', group],
    queryFn: () => unwrap(api.GET('/v1/locations', { params: { query: { ...(group ? { group, includeSubgroups: 'true' as const } : {}), limit: 10_000 } } })),
  });
  const units = useQuery({ queryKey: ['units', 'all'], queryFn: () => unwrap(api.GET('/v1/transport-units', { params: { query: { limit: 10_000 } } })) });
  const lock = useAction(
    (a: { id: string; direction: 'inbound' | 'outbound'; value: boolean }) =>
      unwrap(api.PATCH('/v1/locations/{id}/locks', { params: { path: { id: a.id } }, body: { [a.direction]: a.value, reason: 'Leitstand' } })),
    ['locations'],
    (a) => `${a.direction === 'inbound' ? 'Einlagersperre' : 'Auslagersperre'} ${a.value ? 'gesetzt' : 'aufgehoben'}`,
  );
  const lockGroup = useAction(
    (a: { name: string; direction: 'inbound' | 'outbound'; value: boolean }) =>
      unwrap(api.PATCH('/v1/location-groups/{name}/locks', { params: { path: { name: a.name } }, body: { [a.direction]: a.value } })),
    ['locations'],
    (a) => `Gruppe ${a.name}: ${a.direction === 'inbound' ? 'Einlagersperre' : 'Auslagersperre'} ${a.value ? 'gesetzt' : 'aufgehoben'}`,
  );
  const unitsAt = new Map<string, number>();
  for (const u of units.data?.items ?? []) unitsAt.set(u.location.id, (unitsAt.get(u.location.id) ?? 0) + 1);

  return (
    <>
      <h1>Lagerplätze</h1>
      <ErrorMessage error={groups.error ?? locations.error} />
      <Feedback message={latest(lock.message, lockGroup.message)} />
      <Panel title="Gruppen">
        {groups.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Gruppe</th><th>Übergeordnet</th><th>Einlagerung</th><th>Auslagerung</th><th /></tr>
              </thead>
              <tbody>
                {groups.data.items.map((g) => (
                  <tr key={g.name}>
                    <td><button className="secondary" onClick={() => setGroup(g.name)}>{g.name}</button></td>
                    <td className="muted">{g.parentName ?? '–'}</td>
                    <td><LockBadge lock={g.locks.inbound as Lock} label="Ein" /></td>
                    <td><LockBadge lock={g.locks.outbound as Lock} label="Aus" /></td>
                    <td className="row">
                      {canLock && <button className="secondary" onClick={() => lockGroup.run({ name: g.name, direction: 'inbound', value: !(g.locks.inbound as Lock).own })}>
                        {(g.locks.inbound as Lock).own ? 'Einlagern frei' : 'Einlagern sperren'}
                      </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Noch keine Gruppen.</Empty>
        )}
      </Panel>
      <Panel
        title={group ? `Plätze in ${group} (mit Untergruppen)` : 'Alle Plätze'}
        actions={group ? <button className="secondary" onClick={() => setGroup('')}>alle zeigen</button> : null}
      >
        {locations.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Koordinate</th><th>ERP</th><th>Anlage</th><th>Gruppe</th><th>Typ</th><th className="num">TUs</th><th>Sperren</th><th /></tr>
              </thead>
              <tbody>
                {locations.data.items.map((l) => {
                  const inbound = l.locks.inbound as Lock;
                  const outbound = l.locks.outbound as Lock;
                  return (
                    <tr key={l.id}>
                      <td className="mono">{l.locationId}</td>
                      <td>{l.erpCode ?? '–'}</td>
                      <td>
                        {l.plcCode ?? '–'}
                        {l.plc.state !== 0 && <> <span className="badge bad" title={l.plc.text ?? undefined}>Störung {l.plc.state}</span></>}
                      </td>
                      <td>{l.groupName}</td>
                      <td>{l.typeCode}</td>
                      <td className="num">{unitsAt.get(l.id) ?? 0} / {l.capacity.maxTransportUnits}</td>
                      <td className="row"><LockBadge lock={inbound} label="Ein" /> <LockBadge lock={outbound} label="Aus" /></td>
                      <td className="row">
                        {canLock && <>
                        <button className="secondary" disabled={lock.pending} onClick={() => lock.run({ id: l.id, direction: 'inbound', value: !inbound.own })}>
                          {inbound.own ? 'Ein frei' : 'Ein sperren'}
                        </button>
                        <button className="secondary" disabled={lock.pending} onClick={() => lock.run({ id: l.id, direction: 'outbound', value: !outbound.own })}>
                          {outbound.own ? 'Aus frei' : 'Aus sperren'}
                        </button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Lagerplätze.</Empty>
        )}
      </Panel>
    </>
  );
}
