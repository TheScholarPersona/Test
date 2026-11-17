/**
 * Rechte der API als eine Tabelle: Methode + Pfad → wer darf.
 *
 * Die erste passende Regel gilt. Lesen (GET) darf jede angemeldete Rolle;
 * jede ändernde Anfrage braucht eine ausdrücklich passende Regel, sonst nur
 * `admin` (sicherer Standard: Neue Endpunkte sind erst einmal Admin-Sache).
 */
export const ROLES = ['admin', 'leitstand', 'lager', 'anlage', 'lesen'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Alles, auch Stammdaten, Regelsätze, Materialfluss-Konfiguration und Benutzer',
  leitstand: 'Aufträge steuern (Wareneingang, Auslagerung, Transport), Sperren, Korrekturen, Inventur',
  lager: 'Ausführen am Scanner: TUs bewegen, Ware erfassen, Picks quittieren, Bewegungen bearbeiten',
  anlage: 'Anlagen und Adapter (Node-RED): Geräte-Ereignisse, Fahrbefehle, Transportaufträge',
  lesen: 'Nur ansehen',
};

export type Access = { kind: 'public' } | { kind: 'authenticated' } | { kind: 'roles'; roles: readonly Role[] };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Rule {
  methods: readonly Method[] | '*';
  path: RegExp;
  access: Access;
  /** Für die Dokumentation der Tabelle. */
  note: string;
}

const pub: Access = { kind: 'public' };
const anyone: Access = { kind: 'authenticated' };
const roles = (...r: Role[]): Access => ({ kind: 'roles', roles: r });
const WRITE: Method[] = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ID = '[^/]+';

const OPERATIONS = roles('admin', 'leitstand');
const FLOOR = roles('admin', 'leitstand', 'lager');
const PLANT = roles('admin', 'leitstand', 'anlage');

export const RULES: readonly Rule[] = [
  // Öffentlich
  { methods: ['GET'], path: /^\/health$/, access: pub, note: 'Betriebszustand' },
  { methods: ['GET'], path: /^\/openapi\.json$/, access: pub, note: 'API-Beschreibung' },
  { methods: ['POST'], path: /^\/v1\/auth\/login$/, access: pub, note: 'Anmelden' },
  // Eigene Sitzung
  { methods: ['POST'], path: /^\/v1\/auth\/(logout|password)$/, access: anyone, note: 'Abmelden, eigenes Passwort ändern' },
  // Nur Admin
  { methods: '*', path: /^\/v1\/users(\/.*)?$/, access: roles('admin'), note: 'Benutzerverwaltung' },
  { methods: '*', path: /^\/test(\/.*)?$/, access: roles('admin'), note: 'Test-Endpunkte (nur Testprofil)' },
  // Lesen: jede angemeldete Rolle
  { methods: ['GET'], path: /^\/v1\/.*/, access: anyone, note: 'Lesen' },
  // Sperren (vor den Stammdaten-Regeln, die sonst greifen)
  { methods: ['PATCH'], path: new RegExp(`^/v1/(locations|location-groups)/${ID}/locks$`), access: OPERATIONS, note: 'Platz- und Gruppensperren' },
  { methods: ['PATCH'], path: new RegExp(`^/v1/locations/${ID}/plc-state$`), access: PLANT, note: 'Zustand laut Anlage' },
  // Bewegungsgruppen
  { methods: ['POST'], path: /^\/v1\/movement-groups$/, access: OPERATIONS, note: 'Bewegungsgruppe bilden' },
  { methods: ['PATCH'], path: new RegExp(`^/v1/movement-groups/${ID}$`), access: OPERATIONS, note: 'Bewegungsgruppe ändern' },
  { methods: ['POST'], path: new RegExp(`^/v1/movement-groups/${ID}/assign$`), access: OPERATIONS, note: 'Bewegungsgruppe zuteilen' },
  { methods: ['POST'], path: new RegExp(`^/v1/movement-groups/${ID}/(start|release)$`), access: FLOOR, note: 'Bewegungsgruppe beginnen/zurückgeben' },
  // Bestand
  { methods: ['POST'], path: new RegExp(`^/v1/stock/${ID}/(issues|transfers)$`), access: FLOOR, note: 'Abgang, Umbuchung' },
  { methods: ['POST'], path: new RegExp(`^/v1/stock/${ID}/(corrections|reservations)$`), access: OPERATIONS, note: 'Korrektur, Reservierung' },
  { methods: ['DELETE'], path: new RegExp(`^/v1/stock-reservations/${ID}$`), access: OPERATIONS, note: 'Reservierung aufheben' },
  { methods: ['POST'], path: /^\/v1\/stock-counts$/, access: OPERATIONS, note: 'Inventur öffnen' },
  { methods: ['POST'], path: new RegExp(`^/v1/stock-counts/${ID}/result$`), access: FLOOR, note: 'Zählergebnis erfassen' },
  { methods: ['POST'], path: new RegExp(`^/v1/stock-counts/${ID}/(close|cancel)$`), access: OPERATIONS, note: 'Inventur abschließen/abbrechen' },
  // Transporteinheiten
  { methods: ['POST'], path: /^\/v1\/transport-units$/, access: FLOOR, note: 'TU anlegen' },
  { methods: ['POST'], path: new RegExp(`^/v1/transport-units/${ID}/(move|state|stack|unstack)$`), access: FLOOR, note: 'TU bewegen, Zustand, stapeln' },
  { methods: ['PATCH'], path: new RegExp(`^/v1/transport-units/${ID}$`), access: FLOOR, note: 'TU ändern (Gewicht)' },
  { methods: ['POST'], path: new RegExp(`^/v1/transport-units/${ID}/errors$`), access: roles('admin', 'leitstand', 'lager', 'anlage'), note: 'Fehlermeldung an einer TU' },
  { methods: ['POST'], path: new RegExp(`^/v1/transport-units/${ID}/errors/${ID}/resolve$`), access: FLOOR, note: 'Fehlermeldung erledigen' },
  // Wareneingang
  { methods: ['POST'], path: new RegExp(`^/v1/receiving-orders/${ID}/captures$`), access: FLOOR, note: 'Ware erfassen' },
  { methods: ['POST'], path: /^\/v1\/receiving-blind-captures$/, access: FLOOR, note: 'Erfassung ohne Avis' },
  { methods: WRITE, path: /^\/v1\/receiving-orders(\/.*)?$/, access: OPERATIONS, note: 'Avis anlegen, Positionen/Aufträge schließen' },
  // Auslagerung
  { methods: ['POST'], path: new RegExp(`^/v1/outbound-orders/${ID}/picks/${ID}/confirm$`), access: FLOOR, note: 'Pick quittieren' },
  { methods: WRITE, path: /^\/v1\/outbound-orders(\/.*)?$/, access: OPERATIONS, note: 'Auslageraufträge' },
  // Versand
  { methods: ['POST'], path: new RegExp(`^/v1/shipments/${ID}/load$`), access: FLOOR, note: 'Ladekontrolle (TU verladen)' },
  { methods: WRITE, path: /^\/v1\/shipments(\/.*)?$/, access: OPERATIONS, note: 'Sendungen bilden, Warenausgang, Storno' },
  { methods: ['POST'], path: /^\/v1\/allocation\/simulations$/, access: OPERATIONS, note: 'Auslagerung simulieren' },
  { methods: ['POST'], path: /^\/v1\/putaway\/(decisions|simulations)$/, access: OPERATIONS, note: 'Einlagerplatz bestimmen' },
  // Lagerbewegungen
  { methods: ['POST'], path: new RegExp(`^/v1/movements/${ID}/(start|release|complete)$`), access: FLOOR, note: 'Bewegung bearbeiten' },
  { methods: WRITE, path: /^\/v1\/movements(\/.*)?$/, access: OPERATIONS, note: 'Bewegung anlegen, stornieren' },
  // Transportaufträge und Materialfluss
  { methods: WRITE, path: /^\/v1\/transport-orders(\/.*)?$/, access: PLANT, note: 'Transportaufträge' },
  { methods: ['POST'], path: /^\/v1\/flow\/(events|commands)$/, access: PLANT, note: 'Geräte-Ereignisse, Fahrbefehle' },
];

/** Wer darf `method path`? Ohne passende Regel: nur `admin`. */
export function accessFor(method: string, path: string): Access {
  const m = method.toUpperCase() as Method;
  const rule = RULES.find((r) => (r.methods === '*' || r.methods.includes(m)) && r.path.test(path));
  return rule?.access ?? roles('admin');
}

/** Darf jemand mit diesen Rollen zugreifen? */
export function allows(access: Access, userRoles: readonly Role[]): boolean {
  if (access.kind !== 'roles') return true;
  return userRoles.some((r) => access.roles.includes(r));
}
