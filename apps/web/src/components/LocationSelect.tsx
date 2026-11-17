import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';

/** Auswahl eines Lagerplatzes; Wert ist die Platz-id. */
export function LocationSelect({ value, onChange, label = 'Platz', required = true }: { value: string; onChange: (id: string) => void; label?: string; required?: boolean }) {
  const locations = useQuery({ queryKey: ['locations', 'select'], queryFn: () => unwrap(api.GET('/v1/locations', { params: { query: { limit: 10_000 } } })) });
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">– wählen –</option>
        {locations.data?.items.map((l) => (
          <option key={l.id} value={l.id}>
            {l.erpCode ?? l.plcCode ?? l.locationId} ({l.groupName})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Auswahl eines TU-Typs. */
export function UnitTypeSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const types = useQuery({ queryKey: ['units', 'types'], queryFn: () => unwrap(api.GET('/v1/transport-unit-types')) });
  return (
    <label>
      TU-Typ (neue TU)
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">– wählen –</option>
        {types.data?.items.map((t) => (
          <option key={t.code} value={t.code}>
            {t.code}
          </option>
        ))}
      </select>
    </label>
  );
}
