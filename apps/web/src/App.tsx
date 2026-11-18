import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useSession } from './auth/session';
import { useLive } from './live/events';
import { AccountPage } from './pages/AccountPage';
import { UsersPage } from './pages/UsersPage';
import { EventsPage } from './pages/EventsPage';
import { FlowPage } from './pages/FlowPage';
import { LocationsPage } from './pages/LocationsPage';
import { OutboundPage } from './pages/OutboundPage';
import { OverviewPage } from './pages/OverviewPage';
import { PartnersPage } from './pages/PartnersPage';
import { ShippingPage } from './pages/ShippingPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { ScannerPage } from './pages/ScannerPage';
import { StockPage } from './pages/StockPage';
import { TransportPage } from './pages/TransportPage';

const NAV = [
  ['/', 'Übersicht'],
  ['/lagerplaetze', 'Lagerplätze'],
  ['/bestand', 'Bestand'],
  ['/wareneingang', 'Wareneingang'],
  ['/auslagerung', 'Auslagerung'],
  ['/versand', 'Versand'],
  ['/transport', 'Transport'],
  ['/materialfluss', 'Materialfluss'],
  ['/partner', 'Partner'],
  ['/ereignisse', 'Ereignisse'],
  ['/scanner', 'Scanner'],
] as const;

export function App() {
  const { connected } = useLive();
  const { me, can, logout } = useSession();
  return (
    <div className="shell">
      <nav className="nav" aria-label="Hauptnavigation">
        <div className="brand">
          WMS <span className={`dot ${connected ? 'on' : ''}`} title={connected ? 'Live-Verbindung aktiv' : 'Live-Verbindung getrennt'} />
        </div>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {label}
          </NavLink>
        ))}
        {can('admin') && <NavLink to="/benutzer">Benutzer</NavLink>}
        <div className="spacer" />
        <a className="muted api-link" href="/openapi.json" target="_blank" rel="noreferrer">
          API-Beschreibung
        </a>
        <div className="user" aria-label="Angemeldet">
          <NavLink to="/konto" className="name">{me.displayName}</NavLink>
          <span className="roles muted">{me.roles.join(', ')}</span>
          <button className="secondary" onClick={() => void logout()}>Abmelden</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/lagerplaetze" element={<LocationsPage />} />
          <Route path="/bestand" element={<StockPage />} />
          <Route path="/wareneingang" element={<ReceivingPage />} />
          <Route path="/auslagerung" element={<OutboundPage />} />
          <Route path="/transport" element={<TransportPage />} />
          <Route path="/materialfluss" element={<FlowPage />} />
          <Route path="/versand" element={<ShippingPage />} />
          <Route path="/partner" element={<PartnersPage />} />
          <Route path="/ereignisse" element={<EventsPage />} />
          <Route path="/scanner/*" element={<ScannerPage />} />
          <Route path="/konto" element={<AccountPage />} />
          <Route path="/benutzer" element={can('admin') ? <UsersPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
