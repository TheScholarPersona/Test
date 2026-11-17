import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../api/client';
import type { Role } from '../auth/session';
import { Feedback } from '../components/Feedback';
import { Empty, ErrorMessage, Panel, dateTime } from '../components/ui';
import { useAction } from '../components/useAction';

function RoleChecks({ value, onChange, roles }: { value: Role[]; onChange: (r: Role[]) => void; roles: { role: Role; description: string }[] }) {
  return (
    <div className="row">
      {roles.map(({ role, description }) => (
        <label key={role} title={description} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={value.includes(role)} onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))} />
          {role}
        </label>
      ))}
    </div>
  );
}

export function UsersPage() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/v1/users')) });
  const roles = useQuery({ queryKey: ['users', 'roles'], queryFn: () => unwrap(api.GET('/v1/auth/roles')) });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newRoles, setNewRoles] = useState<Role[]>(['lager']);
  const create = useAction(
    () => unwrap(api.POST('/v1/users', { body: { username, displayName, password, roles: newRoles } })),
    ['users'],
    () => `Benutzer ${username} angelegt`,
  );
  const update = useAction(
    (a: { username: string; change: { roles?: Role[]; active?: boolean; password?: string } }) =>
      unwrap(api.PATCH('/v1/users/{username}', { params: { path: { username: a.username } }, body: a.change })),
    ['users'],
    (a) => `${a.username} geändert`,
  );
  const roleList = roles.data?.items ?? [];
  return (
    <>
      <h1>Benutzer</h1>
      <ErrorMessage error={users.error ?? roles.error} />
      <Panel title="Rollen">
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          {roleList.map((r) => <li key={r.role}><strong>{r.role}</strong>: {r.description}</li>)}
        </ul>
      </Panel>
      <Panel title="Benutzer anlegen">
        <Feedback message={create.message} />
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            create.run(undefined);
          }}
        >
          <label>Benutzername<input value={username} onChange={(e) => setUsername(e.target.value.trim().toLowerCase())} required /></label>
          <label>Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label>Startpasswort (mind. 10 Zeichen)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} autoComplete="new-password" required /></label>
          <RoleChecks value={newRoles} onChange={setNewRoles} roles={roleList} />
          <button disabled={create.pending || newRoles.length === 0}>Anlegen</button>
        </form>
      </Panel>
      <Panel title="Alle Benutzer">
        <Feedback message={update.message} />
        {users.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Benutzer</th><th>Name</th><th>Rollen</th><th>Zustand</th><th>zuletzt angemeldet</th><th /></tr></thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.username}>
                    <td className="mono">{u.username}</td>
                    <td>{u.displayName || '–'}</td>
                    <td><RoleChecks value={u.roles} onChange={(r) => r.length && update.run({ username: u.username, change: { roles: r } })} roles={roleList} /></td>
                    <td><span className={`badge ${u.active ? 'ok' : 'neutral'}`}>{u.active ? 'aktiv' : 'gesperrt'}</span></td>
                    <td>{dateTime(u.lastLoginAt)}</td>
                    <td className="row">
                      <button className="secondary" onClick={() => update.run({ username: u.username, change: { active: !u.active } })}>{u.active ? 'Sperren' : 'Entsperren'}</button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const pw = window.prompt(`Neues Passwort für ${u.username} (mind. 10 Zeichen)`);
                          if (pw) update.run({ username: u.username, change: { password: pw } });
                        }}
                      >
                        Passwort setzen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Keine Benutzer.</Empty>
        )}
      </Panel>
    </>
  );
}
