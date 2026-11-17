import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useState } from 'react';
import { api, describeError, unwrap } from '../api/client';
import type { components } from '../api/schema';

export type Role = components['schemas']['Me']['roles'][number];
export type Me = components['schemas']['Me'];

interface SessionValue {
  me: Me;
  /** Darf der angemeldete Benutzer eine der Rollen? (Nur für die Anzeige – die API prüft selbst.) */
  can: (...roles: Role[]) => boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession außerhalb von SessionProvider');
  return value;
}

/** Bequemer Prüfer: `can('leitstand')` – admin darf immer. */
export function useCan() {
  return useSession().can;
}

function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/v1/auth/login', { body: { username, password } }));
      setPassword('');
      onLoggedIn();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="panel stack" onSubmit={submit} aria-label="Anmeldung">
        <h1>WMS – Anmelden</h1>
        {error && <div className="message error" role="alert">{error}</div>}
        <label>
          Benutzername
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button disabled={busy}>Anmelden</button>
      </form>
    </div>
  );
}

/**
 * Zeigt die Anmeldung, solange niemand angemeldet ist. Läuft die Sitzung ab
 * (eine Anfrage antwortet 401), erscheint die Anmeldung wieder.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const r = await api.GET('/v1/auth/me');
      return r.response.status === 401 ? null : unwrap(Promise.resolve(r));
    },
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const handler = () => void client.invalidateQueries({ queryKey: ['auth', 'me'] });
    window.addEventListener('wms:unauthenticated', handler);
    return () => window.removeEventListener('wms:unauthenticated', handler);
  }, [client]);

  if (me.isPending) return <p className="muted" style={{ padding: 24 }}>Lade …</p>;
  if (!me.data) {
    return (
      <LoginPage
        onLoggedIn={() => {
          client.clear();
          void me.refetch();
        }}
      />
    );
  }
  const roles = me.data.roles;
  const value: SessionValue = {
    me: me.data,
    can: (...allowed) => roles.includes('admin') || allowed.some((r) => roles.includes(r)),
    logout: async () => {
      await api.POST('/v1/auth/logout');
      client.clear();
      await me.refetch();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
