import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { api, describeError, unwrap } from '../api/client';
import { Quantity } from '../components/ui';

type Result = { kind: 'success' | 'error'; text: string } | null;

function Result({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <div className={`message ${result.kind}`} role={result.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: '1.1rem' }}>
      {result.text}
    </div>
  );
}

/** Scan → TU auf Platz buchen (geprüft). Nach jedem Scan zurück zum ersten Feld. */
function MoveTab() {
  const [barcode, setBarcode] = useState('');
  const [location, setLocation] = useState('');
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await unwrap(api.POST('/v1/transport-units/{barcode}/move', { params: { path: { barcode } }, body: { to: { erpCode: location }, mode: 'checked' } }));
      setResult({ kind: 'success', text: `${r.unit.barcode} steht auf ${r.unit.location.erpCode ?? r.unit.location.locationId}` });
      setBarcode('');
      setLocation('');
    } catch (error) {
      setResult({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(false);
      first.current?.focus();
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Result result={result} />
      <label>TU scannen<input ref={first} value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} autoFocus required autoComplete="off" /></label>
      <label>Platz scannen (ERP-Code)<input value={location} onChange={(e) => setLocation(e.target.value.trim())} required autoComplete="off" /></label>
      <button disabled={busy}>Buchen</button>
    </form>
  );
}

/** Offene Picks nach Platz; Quittung mit tatsächlicher Menge. */
function PickTab() {
  const picks = useQuery({ queryKey: ['picks', 'open'], queryFn: () => unwrap(api.GET('/v1/outbound-picks', { params: { query: { state: 'OPEN', limit: 100 } } })) });
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [scan, setScan] = useState('');
  const [result, setResult] = useState<Result>(null);
  const pick = picks.data?.items.find((p) => p.id === selected);
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    if (scan && scan !== pick.barcode) {
      setResult({ kind: 'error', text: `Falsche TU: gescannt ${scan}, erwartet ${pick.barcode}` });
      return;
    }
    try {
      await unwrap(
        api.POST('/v1/outbound-orders/{orderId}/picks/{pickId}/confirm', {
          params: { path: { orderId: pick.orderId, pickId: pick.id } },
          body: { quantity: { amount: amount || pick.quantity.amount, unit: pick.quantity.unit }, pickedBy: 'scanner' },
        }),
      );
      setResult({ kind: 'success', text: `Pick ${pick.sku} von ${pick.barcode} quittiert` });
      setSelected(null);
      setAmount('');
      setScan('');
      await picks.refetch();
    } catch (error) {
      setResult({ kind: 'error', text: describeError(error) });
    }
  };
  if (pick) {
    return (
      <form className="stack" onSubmit={confirm}>
        <Result result={result} />
        <div className="panel">
          <div style={{ fontSize: '1.2rem', fontWeight: 650 }}>{pick.sku}</div>
          <div>Platz <span className="mono">{pick.locationId}</span></div>
          <div>TU <span className="mono">{pick.barcode}</span></div>
          <div>Menge <Quantity q={pick.quantity} /></div>
          <div className="muted">Auftrag {pick.orderId}, Position {pick.lineNo}</div>
        </div>
        <label>TU scannen (Kontrolle)<input value={scan} onChange={(e) => setScan(e.target.value.trim())} autoFocus autoComplete="off" /></label>
        <label>Entnommene Menge ({pick.quantity.unit})<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={pick.quantity.amount} inputMode="decimal" /></label>
        <button>Quittieren</button>
        <button type="button" className="secondary" onClick={() => setSelected(null)}>Zurück</button>
      </form>
    );
  }
  return (
    <div className="stack">
      <Result result={result} />
      {picks.data?.items.length ? (
        picks.data.items.map((p) => (
          <button key={p.id} className="secondary" style={{ textAlign: 'left' }} onClick={() => { setSelected(p.id); setResult(null); }}>
            <strong>{p.locationId}</strong> · {p.sku} · {p.quantity.amount} {p.quantity.unit}
            <div className="muted mono">{p.barcode} · {p.orderId}</div>
          </button>
        ))
      ) : (
        <p className="muted">Keine offenen Picks.</p>
      )}
    </div>
  );
}

/** Wareneingang ohne Avis: Ware auf eine TU erfassen. */
function ReceiveTab() {
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [barcode, setBarcode] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [location, setLocation] = useState('');
  const [result, setResult] = useState<Result>(null);
  const first = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await unwrap(
        api.POST('/v1/receiving-blind-captures', {
          body: { sku, quantity: { amount, unit }, unit: { ...(barcode ? { barcode } : {}), ...(typeCode ? { typeCode } : {}) }, location: { erpCode: location } },
        }),
      );
      setResult({ kind: 'success', text: `${amount} ${unit} ${sku} auf ${r.barcode} (Bestand ${r.onHand?.amount ?? "?"})` });
      setSku('');
      setAmount('');
      setBarcode('');
    } catch (error) {
      setResult({ kind: 'error', text: describeError(error) });
    } finally {
      first.current?.focus();
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Result result={result} />
      <label>Artikel (SKU)<input ref={first} value={sku} onChange={(e) => setSku(e.target.value.trim())} autoFocus required /></label>
      <div className="row">
        <label style={{ flex: 2 }}>Menge<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
        <label style={{ flex: 1 }}>Einheit<input value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} required /></label>
      </div>
      <label>TU scannen (leer = neue TU)<input value={barcode} onChange={(e) => setBarcode(e.target.value.trim())} autoComplete="off" /></label>
      <label>TU-Typ (nur neue TU)<input value={typeCode} onChange={(e) => setTypeCode(e.target.value.trim().toUpperCase())} /></label>
      <label>Platz (ERP-Code)<input value={location} onChange={(e) => setLocation(e.target.value.trim())} required /></label>
      <button>Erfassen</button>
    </form>
  );
}

export function ScannerPage() {
  return (
    <div className="scanner">
      <h1>Scanner</h1>
      <nav className="tabs" aria-label="Scanner">
        {/* Absolute Pfade: relative Links in einer Platzhalter-Route (/scanner/*) beziehen sich auf die volle URL. */}
        <NavLink to="/scanner/bewegen">Bewegen</NavLink>
        <NavLink to="/scanner/picken">Picken</NavLink>
        <NavLink to="/scanner/wareneingang">Eingang</NavLink>
      </nav>
      <Routes>
        <Route path="bewegen" element={<MoveTab />} />
        <Route path="picken" element={<PickTab />} />
        <Route path="wareneingang" element={<ReceiveTab />} />
        <Route path="*" element={<Navigate to="/scanner/bewegen" replace />} />
      </Routes>
    </div>
  );
}
