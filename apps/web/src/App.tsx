import { NavLink, Navigate, Route, Routes } from 'react-router';
import { useLive } from './live/events';
import { EventsPage } from './pages/EventsPage';
import { FlowPage } from './pages/FlowPage';
import { LocationsPage } from './pages/LocationsPage';
import { OutboundPage } from './pages/OutboundPage';
import { OverviewPage } from './pages/OverviewPage';
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
  ['/transport', 'Transport'],
  ['/materialfluss', 'Materialfluss'],
  ['/ereignisse', 'Ereignisse'],
  ['/scanner', 'Scanner'],
] as const;

export function App() {
  const { connected } = useLive();
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
        <div className="spacer" />
        <a className="muted api-link" href="/openapi.json" target="_blank" rel="noreferrer">
          API-Beschreibung
        </a>
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
          <Route path="/ereignisse" element={<EventsPage />} />
          <Route path="/scanner/*" element={<ScannerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
