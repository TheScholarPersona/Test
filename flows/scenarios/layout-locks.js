/**
 * Szenario: Sperrvererbung in der Lagerstruktur.
 *
 * Läuft in der Node-RED-Schritt-Engine (Tab „Schritt-Engine“). Verfügbar sind:
 *   registerScenario(definition)  – Szenario anmelden
 *
 * Ein Schritt ist entweder
 *   { name, request: (v) => ({ method, path, body? }), expectStatus?, check?: (body, v) => Fehlertext|null, save?: (body, v) => void }
 * oder
 *   { name, event: (event, v) => boolean }   – wartet auf ein passendes MQTT-Event (Timeout SCENARIO_EVENT_TIMEOUT_MS)
 * `cleanup: true` markiert Aufräumschritte; sie laufen auch nach einem Fehler.
 * Gibt `request` null zurück, wird der Schritt übersprungen.
 * `v` enthält die Variablen des Laufs (aus init) und wird von save ergänzt.
 *
 * Geprüfte Regeln (docs/openwms-analyse.md, Kap. 3.5): L-03 Sperrvererbung,
 * L-04 kein Entsperren unter gesperrter Gruppe, Event bei Sperränderung.
 */
registerScenario({
  id: 'layout-locks',
  description: 'Sperre einer Obergruppe wirkt auf Untergruppe und Platz; Entsperren darunter wird abgelehnt.',
  init: (runId) => {
    const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      type: `SZ-${suffix}`,
      root: `SZ-${suffix}-OBEN`,
      child: `SZ-${suffix}-UNTEN`,
      locationId: `S${suffix}/0001/0001/0001/0000`,
      id: null,
    };
  },
  steps: [
    {
      name: 'Platztyp anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.type, description: 'Szenario layout-locks' } }),
      expectStatus: 201,
    },
    {
      name: 'Obergruppe anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.root } }),
      expectStatus: 201,
    },
    {
      name: 'Untergruppe anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.child, parentName: v.root } }),
      expectStatus: 201,
    },
    {
      name: 'Lagerplatz in der Untergruppe anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.locationId, typeCode: v.type, groupName: v.child } }),
      expectStatus: 201,
      save: (body, v) => {
        v.id = body.id;
      },
    },
    {
      name: 'Obergruppe für Einlagerung sperren',
      request: (v) => ({
        method: 'PATCH',
        path: `/v1/location-groups/${v.root}/locks`,
        body: { inbound: true, reason: 'Szenario layout-locks' },
      }),
      expectStatus: 200,
    },
    {
      name: 'Event location-group.lock-changed empfangen',
      event: (e, v) =>
        e.type === 'location-group.lock-changed' && e.payload.name === v.root && e.payload.change.inbound.after === true,
    },
    {
      name: 'Platz ist über die Obergruppe gesperrt',
      request: (v) => ({ method: 'GET', path: `/v1/locations/${v.id}` }),
      expectStatus: 200,
      check: (body, v) => {
        const lock = body.locks.inbound;
        if (lock.own !== false || lock.blocked !== true || !lock.blockedBy || lock.blockedBy.name !== v.root) {
          return `Erwartet geerbte Sperre von ${v.root}, erhalten ${JSON.stringify(lock)}`;
        }
        return null;
      },
    },
    {
      name: 'Untergruppe kann nicht entsperrt werden (LOCK_INHERITED)',
      request: (v) => ({ method: 'PATCH', path: `/v1/location-groups/${v.child}/locks`, body: { inbound: false } }),
      expectStatus: 409,
      check: (body) => (body.code === 'LOCK_INHERITED' ? null : `Erwartet Fehlercode LOCK_INHERITED, erhalten ${body.code}`),
    },
    {
      name: 'Obergruppe entsperren',
      request: (v) => ({ method: 'PATCH', path: `/v1/location-groups/${v.root}/locks`, body: { inbound: false } }),
      expectStatus: 200,
    },
    {
      name: 'Platz ist wieder frei',
      request: (v) => ({ method: 'GET', path: `/v1/locations/${v.id}` }),
      expectStatus: 200,
      check: (body) => (body.locks.inbound.blocked === false ? null : `Platz noch gesperrt: ${JSON.stringify(body.locks.inbound)}`),
    },
    {
      name: 'Aufräumen: Obergruppe entsperren',
      cleanup: true,
      request: (v) => ({ method: 'PATCH', path: `/v1/location-groups/${v.root}/locks`, body: { inbound: false } }),
    },
    {
      name: 'Aufräumen: Lagerplatz löschen',
      cleanup: true,
      request: (v) => (v.id ? { method: 'DELETE', path: `/v1/locations/${v.id}` } : null),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Untergruppe löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.child}` }),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Obergruppe löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.root}` }),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Platztyp löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.type}` }),
      expectStatus: 204,
    },
  ],
});
