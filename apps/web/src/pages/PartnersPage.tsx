import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { useCan } from '../auth/session';
import { Feedback, latest } from '../components/Feedback';
import { addressLine } from '../components/PartnerSelect';
import { Empty, ErrorMessage, Panel } from '../components/ui';
import { useAction } from '../components/useAction';

type Role = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
const ROLES: [Role, string][] = [
  ['CUSTOMER', 'Kunde'],
  ['SUPPLIER', 'Lieferant'],
  ['CARRIER', 'Spediteur'],
];
const roleText = (r: Role) => ROLES.find(([x]) => x === r)?.[1] ?? r;

function CreatePartner() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['CUSTOMER']);
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DE');
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const create = useAction(
    () => unwrap(api.POST('/v1/partners', { body: { code, name, roles, address: { street: opt(street), postalCode: opt(postalCode), city: opt(city), country: opt(country) } } })),
    ['partners'],
    () => `Partner ${code} angelegt`,
  );
  return (
    <Panel title="Partner anlegen">
      <Feedback message={create.message} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          create.run(undefined);
        }}
      >
        <label>Partnernummer<input value={code} onChange={(e) => setCode(e.target.value.trim())} required /></label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <div className="row" role="group" aria-label="Rollen">
          {ROLES.map(([role, text]) => (
            <label key={role} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={roles.includes(role)} onChange={(e) => setRoles(e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))} />
              {text}
            </label>
          ))}
        </div>
        <label>Straße<input value={street} onChange={(e) => setStreet(e.target.value)} /></label>
        <label>PLZ<input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} size={6} /></label>
        <label>Ort<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>Land<input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} size={3} /></label>
        <button disabled={create.pending || roles.length === 0}>Anlegen</button>
      </form>
    </Panel>
  );
}

export function PartnersPage() {
  const can = useCan();
  const [role, setRole] = useState<Role | ''>('');
  const [q, setQ] = useState('');
  const partners = useQuery({
    queryKey: ['partners', 'list', role, q],
    queryFn: () => unwrap(api.GET('/v1/partners', { params: { query: { limit: 500, ...(role ? { role } : {}), ...(q.trim() ? { q: q.trim() } : {}) } } })),
  });
  const toggle = useAction(
    (p: { code: string; active: boolean }) => unwrap(api.PATCH('/v1/partners/{code}', { params: { path: { code: p.code } }, body: { active: p.active } })),
    ['partners'],
    (p) => `${p.code} ${p.active ? 'aktiviert' : 'deaktiviert'}`,
  );
  return (
    <>
      <h1>Geschäftspartner</h1>
      <ErrorMessage error={partners.error} />
      {can('admin') && <CreatePartner />}
      <Panel
        title="Partner"
        actions={
          <div className="row">
            <label>Rolle
              <select value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
                <option value="">alle</option>
                {ROLES.map(([r, text]) => <option key={r} value={r}>{text}</option>)}
              </select>
            </label>
            <label>Suche<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer, Name, Ort" /></label>
          </div>
        }
      >
        <Feedback message={latest(toggle.message)} />
        {partners.data?.items.length ? (
          <div className="table-wrap">
            <table aria-label="Geschäftspartner">
              <thead><tr><th>Nummer</th><th>Name</th><th>Rollen</th><th>Anschrift</th><th>Zustand</th><th /></tr></thead>
              <tbody>
                {partners.data.items.map((p) => (
                  <tr key={p.code}>
                    <td className="mono">{p.code}</td>
                    <td>{p.name}</td>
                    <td>{p.roles.map(roleText).join(', ')}</td>
                    <td>{addressLine(p.address)}</td>
                    <td><span className={`badge ${p.active ? 'ok' : 'neutral'}`}>{p.active ? 'aktiv' : 'inaktiv'}</span></td>
                    <td>
                      {can('admin') && (
                        <button className="secondary" onClick={() => toggle.run({ code: p.code, active: !p.active })}>
                          {p.active ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Partner.</Empty>
        )}
      </Panel>
    </>
  );
}
