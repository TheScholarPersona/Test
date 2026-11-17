import { useState } from 'react';
import { api, unwrap } from '../api/client';
import { useSession } from '../auth/session';
import { Feedback } from '../components/Feedback';
import { Panel } from '../components/ui';
import { useAction } from '../components/useAction';

export function AccountPage() {
  const { me } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useAction(
    () => unwrap(api.POST('/v1/auth/password', { body: { currentPassword: current, newPassword: next } })),
    [],
    () => 'Passwort geändert; andere Sitzungen wurden beendet',
  );
  return (
    <>
      <h1>Konto</h1>
      <Panel title={me.displayName}>
        <p>
          Benutzer <span className="mono">{me.username}</span> · Rollen {me.roles.map((r) => <span key={r} className="badge neutral" style={{ marginRight: 4 }}>{r}</span>)}
        </p>
      </Panel>
      {me.kind === 'user' && (
        <Panel title="Passwort ändern">
          <Feedback message={change.message} />
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              change.run(undefined);
              setCurrent('');
              setNext('');
            }}
          >
            <label>Bisheriges Passwort<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
            <label>Neues Passwort (mind. 10 Zeichen)<input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
            <button disabled={change.pending}>Ändern</button>
          </form>
        </Panel>
      )}
    </>
  );
}
