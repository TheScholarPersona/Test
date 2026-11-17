/**
 * Szenario: Auslagerung.
 *
 * Zwei TUs mit unterschiedlichem MHD. Die Strategie wird per Simulation mit
 * einem Entwurf geprüft (FEFO wählt das frühere MHD) – der Entwurf wird danach
 * gelöscht, ein aktiver Regelsatz bleibt unberührt. Ist für die Auslagerung
 * noch kein Regelsatz aktiv, legt das Szenario einen FIFO-Standard an und
 * aktiviert ihn (er bleibt bestehen). Der Auftrag braucht den ganzen Bestand,
 * das Ergebnis hängt deshalb nicht von der aktiven Strategie ab.
 * Danach: Zuteilung mit Lagerbewegungen zum Versandplatz, eine volle und eine
 * Fehlmengen-Quittung, Abschluss mit Fehlmenge.
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'outbound-flow',
  description: 'Auslagerung: FEFO-Simulation, Zuteilung mit Reservierung und Bewegungen, Pick mit Fehlmenge, Abschluss.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    return {
      locationType: `SA-${s}`,
      group: `SA-${s}-G`,
      unitType: `SA-${s}`,
      sku: `SA-${s}-ART`,
      orderId: `SA-${s}-AUF`,
      coords: { a: `A${s}/0001/0001/0001/0000`, b: `A${s}/0002/0001/0001/0000`, v: `A${s}/0009/0001/0001/0000` },
      loc: {},
      tu: { late: `SA-${s}-SPAET`, early: `SA-${s}-FRUEH` },
      bestBefore: { late: inDays(200), early: inDays(100) },
      draft: null,
      hasActive: true,
      created: null,
      picks: [],
      movements: [],
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }), expectStatus: 201 },
    ...['a', 'b', 'v'].map((key) => ({
      name: `Platz ${key} anlegen`,
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.coords[key], typeCode: v.locationType, groupName: v.group, maxTransportUnits: 10 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    {
      name: 'Produkt in PCS mit Karton (6 PCS) anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/products', body: { sku: v.sku, baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '6' }] } }),
      expectStatus: 201,
    },
    ...[
      ['late', 'a'],
      ['early', 'b'],
    ].map(([tu, at]) => ({
      name: `Zugang 12 PCS auf TU mit ${tu === 'late' ? 'spätem' : 'frühem'} MHD`,
      request: (v) => ({
        method: 'POST',
        path: '/v1/receiving-blind-captures',
        body: { sku: v.sku, quantity: { amount: '12', unit: 'PCS' }, unit: { barcode: v.tu[tu], typeCode: v.unitType }, location: { id: v.loc[at] }, bestBefore: v.bestBefore[tu] },
      }),
      expectStatus: 201,
    })),

    // --- Strategie per Simulation (Entwurf, ohne Aktivierung) ---------------------
    {
      name: 'Entwurf FEFO anlegen',
      request: () => ({
        method: 'POST',
        path: '/v1/strategy-rule-sets',
        body: { decisionPoint: 'allocation', description: 'Szenario outbound-flow', rules: [{ name: 'fefo', when: { always: true }, strategy: 'fefo', params: {} }] },
      }),
      expectStatus: 201,
      save: (body, v) => {
        v.draft = body.id;
      },
    },
    {
      name: 'Simulation mit Entwurf: FEFO nimmt das frühere MHD',
      request: (v) => ({ method: 'POST', path: '/v1/allocation/simulations', body: { sku: v.sku, quantity: { amount: '1', unit: 'KAR' }, ruleSetId: v.draft } }),
      expectStatus: 200,
      check: (body, v) =>
        body.plan.length === 1 && body.plan[0].barcode === v.tu.early && body.plan[0].quantity === '6' && body.decision.strategy === 'fefo'
          ? null
          : `Unerwartet: ${JSON.stringify(body.plan)}`,
    },
    { name: 'Entwurf löschen', request: (v) => ({ method: 'DELETE', path: `/v1/strategy-rule-sets/${v.draft}` }), expectStatus: 204, save: (body, v) => (v.draft = null) },

    // --- Aktiver Regelsatz (nur falls keiner existiert) ---------------------------
    {
      name: 'Aktiven Auslager-Regelsatz suchen',
      request: () => ({ method: 'GET', path: '/v1/strategy-rule-sets?decisionPoint=allocation' }),
      expectStatus: 200,
      save: (body, v) => {
        v.hasActive = (body.items || []).some((r) => r.status === 'ACTIVE');
      },
    },
    {
      name: 'Falls keiner aktiv: FIFO-Standard anlegen',
      request: (v) =>
        v.hasActive
          ? null
          : {
              method: 'POST',
              path: '/v1/strategy-rule-sets',
              body: { decisionPoint: 'allocation', description: 'Standard (vom Szenario outbound-flow angelegt)', rules: [{ name: 'standard', when: { always: true }, strategy: 'fifo', params: {} }] },
            },
      expectStatus: 201,
      save: (body, v) => {
        v.created = body.id;
      },
    },
    { name: 'Falls keiner aktiv: FIFO-Standard aktivieren', request: (v) => (v.created ? { method: 'POST', path: `/v1/strategy-rule-sets/${v.created}/activate` } : null), expectStatus: 200 },

    // --- Auftrag ------------------------------------------------------------------
    {
      name: 'Auftrag über 4 Kartons (24 PCS) mit Versandplatz anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/outbound-orders', body: { orderId: v.orderId, target: { id: v.loc.v }, lines: [{ sku: v.sku, quantity: { amount: '4', unit: 'KAR' } }] } }),
      expectStatus: 201,
      check: (body) => (body.lines[0].quantity.amount === '24' ? null : `Unerwartet: ${JSON.stringify(body.lines)}`),
    },
    {
      name: 'Zuteilen mit Lagerbewegungen zum Versandplatz',
      request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.orderId}/allocate`, body: { transport: 'movement' } }),
      expectStatus: 200,
      check: (body) =>
        body.state === 'ALLOCATED' && body.picks.length === 2 && body.picks.every((p) => p.movementNumber && p.quantity.amount === '12') ? null : `Unerwartet: ${JSON.stringify(body)}`,
      save: (body, v) => {
        v.picks = body.picks.map((p) => p.id);
        v.movements = body.picks.map((p) => p.movementNumber);
      },
    },
    { name: 'Event outbound-order.allocated', event: (e, v) => e.type === 'outbound-order.allocated' && e.payload.orderId === v.orderId && e.payload.picks.length === 2 },
    {
      name: 'Bestand ist reserviert',
      request: (v) => ({ method: 'GET', path: `/v1/stock/summary?sku=${v.sku}` }),
      expectStatus: 200,
      check: (body) => (body.items[0].reserved.amount === '24' && body.items[0].available.amount === '0' ? null : `Unerwartet: ${JSON.stringify(body.items)}`),
    },
    {
      name: 'Erster Pick vollständig quittiert',
      request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.orderId}/picks/${v.picks[0]}/confirm`, body: { pickedBy: 'node-red' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'IN_PICKING' ? null : `Unerwartet: ${body.state}`),
    },
    {
      name: 'Zweiter Pick mit Fehlmenge (1 Karton statt 2)',
      request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.orderId}/picks/${v.picks[1]}/confirm`, body: { quantity: { amount: '1', unit: 'KAR' } } }),
      expectStatus: 200,
      check: (body) => (body.lines[0].picked.amount === '18' && body.lines[0].open.amount === '6' ? null : `Unerwartet: ${JSON.stringify(body.lines)}`),
    },
    { name: 'Event outbound-pick.confirmed mit Fehlmenge', event: (e, v) => e.type === 'outbound-pick.confirmed' && e.payload.pickId === v.picks[1] && e.payload.short === true },
    {
      name: 'Auftrag mit Fehlmenge abschließen',
      request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.orderId}/complete`, body: { reason: 'Rest nicht vorhanden' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'COMPLETED' && body.lines[0].state === 'SHORT' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    { name: 'Event outbound-order.state-changed (COMPLETED)', event: (e, v) => e.type === 'outbound-order.state-changed' && e.payload.orderId === v.orderId && e.payload.state === 'COMPLETED' },
    {
      name: 'Journal: zwei Abgänge (12 und 6 PCS)',
      request: (v) => ({ method: 'GET', path: `/v1/stock-bookings?reference=outbound:${v.orderId}/1` }),
      expectStatus: 200,
      check: (body) => {
        const amounts = body.items.map((b) => `${b.type}:${b.quantity.amount}`).sort();
        return JSON.stringify(amounts) === JSON.stringify(['ISSUE:-12', 'ISSUE:-6']) ? null : `Unerwartet: ${JSON.stringify(amounts)}`;
      },
    },
    {
      name: 'Restbestand 6 PCS ist wieder verfügbar',
      request: (v) => ({ method: 'GET', path: `/v1/stock/summary?sku=${v.sku}` }),
      expectStatus: 200,
      check: (body) => (body.items[0].onHand.amount === '6' && body.items[0].reserved.amount === '0' ? null : `Unerwartet: ${JSON.stringify(body.items)}`),
    },

    // --- Aufräumen ------------------------------------------------------------------
    { name: 'Aufräumen: Entwurf löschen (falls noch vorhanden)', cleanup: true, request: (v) => (v.draft ? { method: 'DELETE', path: `/v1/strategy-rule-sets/${v.draft}` } : null) },
    { name: 'Aufräumen: Auftrag stornieren (falls offen)', cleanup: true, request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.orderId}/cancel`, body: { reason: 'Aufräumen' } }) },
    ...[0, 1].map((i) => ({
      name: `Aufräumen: Lagerbewegung ${i + 1} stornieren`,
      cleanup: true,
      request: (v) => (v.movements[i] ? { method: 'POST', path: `/v1/movements/${v.movements[i]}/cancel`, body: { reason: 'Aufräumen' } } : null),
    })),
    ...['late', 'early'].map((tu) => ({
      name: `Aufräumen: Bestand auf TU ${tu} lesen`,
      cleanup: true,
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu[tu]}` }),
      save: (body, v) => {
        v[`rest_${tu}`] = (body.items || [])[0] || null;
      },
    })),
    ...['late', 'early'].map((tu) => ({
      name: `Aufräumen: Restbestand auf TU ${tu} ausbuchen`,
      cleanup: true,
      request: (v) => {
        const rest = v[`rest_${tu}`];
        return rest ? { method: 'POST', path: `/v1/stock/${rest.id}/corrections`, body: { delta: { amount: `-${rest.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' } } : null;
      },
    })),
    ...['late', 'early'].map((tu) => ({ name: `Aufräumen: TU ${tu} löschen`, cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu[tu]}` }) })),
    ...['a', 'b', 'v'].map((key) => ({
      name: `Aufräumen: Platz ${key} löschen`,
      cleanup: true,
      request: (v) => (v.loc[key] ? { method: 'DELETE', path: `/v1/locations/${v.loc[key]}` } : null),
      expectStatus: 204,
    })),
    { name: 'Aufräumen: Gruppe löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.group}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
