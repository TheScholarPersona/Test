import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';

type Role = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';

/** Auswahl eines aktiven Geschäftspartners mit der Rolle; Wert ist die Partnernummer. */
export function PartnerSelect({ value, onChange, role, label }: { value: string; onChange: (code: string) => void; role: Role; label: string }) {
  const partners = useQuery({ queryKey: ['partners', 'select', role], queryFn: () => unwrap(api.GET('/v1/partners', { params: { query: { role, active: 'true', limit: 500 } } })) });
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">– ohne –</option>
        {partners.data?.items.map((p) => (
          <option key={p.code} value={p.code}>
            {p.code} {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Anschrift einzeilig, z. B. „Musterstraße 1, 12345 Musterstadt, DE“. */
export function addressLine(a: { name?: string | null; street: string | null; postalCode: string | null; city: string | null; country: string | null } | null | undefined): string {
  if (!a) return '–';
  const place = [a.postalCode, a.city].filter(Boolean).join(' ');
  return [a.name, a.street, place, a.country].filter(Boolean).join(', ') || '–';
}
