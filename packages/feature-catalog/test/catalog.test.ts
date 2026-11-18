import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, ownsPath } from '../src/analyze.ts';
import { buildView } from '../src/build.ts';
import { containsTitle, discover, type Discovery, filesCalling, REPO_ROOT } from '../src/discover.ts';
import { parseJunit, resultOf } from '../src/junit.ts';
import { type CatalogData, loadCatalog } from '../src/load.ts';
import { accessOf } from '../src/roles.ts';
import { Feature, Taxonomy } from '../src/schema.ts';

/** Prüft den echten Katalog gegen den aktuellen Code (statisch, ohne Testberichte). */
describe('Katalog im Repository', () => {
  const data = loadCatalog(join(REPO_ROOT, 'catalog'));
  const analysis = analyze(data, discover());

  it('hat keine Fehler', () => {
    const errors = analysis.findings.filter((f) => f.level === 'fehler').map((f) => `${f.code} ${f.subject} – ${f.message}`);
    expect(errors, 'pnpm catalog:check zeigt die Befunde mit Erklärung').toEqual([]);
  });

  it('ordnet jeden erkannten Bestandteil einem Bereich zu', () => {
    expect(analysis.unowned).toEqual([]);
  });

  it('erzeugt eine eigenständige Ansicht aus denselben Daten', () => {
    const out = mkdtempSync(join(tmpdir(), 'katalog-'));
    try {
      buildView(analysis, data, out);
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      const json = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')) as { features: { id: string }[] };
      expect(json.features.map((f) => f.id)).toEqual(data.features.map((f) => f.id));
      const embedded = /<script id="catalog-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
      expect(JSON.parse(embedded).features).toHaveLength(data.features.length);
      expect(html).not.toContain('/*__CATALOG_');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

// --- Regeln an kleinen Beispielen ------------------------------------------------------

const taxonomy = Taxonomy.parse({
  schemaVersion: 1,
  areas: [
    { id: 'lager', title: 'Lager', summary: 'x', status: 'katalogisiert', owns: { endpoints: ['/v1/dinge'], events: ['ding'] }, groups: [{ id: 'lager.g', title: 'G', summary: 'x' }] },
    { id: 'rest', title: 'Rest', summary: 'x', status: 'offen', owns: { endpoints: ['/v1/rest'] } },
  ],
});

const DINGE = 'apps/api/test/integration/dinge.test.ts';
const DINGE_TEST = "it('legt Dinge an', async () => { expect(await api.post('/v1/dinge', {})).toMatchObject({ status: 201, body: { name: 'A' } }); })";

function discovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    root: REPO_ROOT,
    endpoints: new Map(
      ['GET /v1/dinge', 'POST /v1/dinge', 'GET /v1/rest'].map((ref) => {
        const [method, path] = ref.split(' ') as [string, string];
        return [ref, { ref, method, path, summary: ref, tags: [] }];
      }),
    ),
    events: new Set(['ding.angelegt']),
    uiRoutes: new Set(),
    nodeRedNodes: new Set(),
    scenarios: new Set(['dinge-flow']),
    testFiles: [{ path: DINGE, text: DINGE_TEST }],
    callingFiles: [{ path: DINGE, text: DINGE_TEST }],
    ...overrides,
  };
}

const feature = (overrides: Record<string, unknown> = {}) =>
  Feature.parse({
    id: 'lager.anlegen',
    title: 'Dinge anlegen',
    group: 'lager.g',
    summary: 'x',
    description: 'x',
    usage: [{ channel: 'api', text: 'x' }],
    technical: { components: ['packages/feature-catalog/src'], endpoints: ['POST /v1/dinge'], events: { emits: ['ding.angelegt'] } },
    acceptance: [{ id: 'angelegt', kind: 'effekt', text: 'Das Ding steht mit Namen bereit.' }],
    evidence: [{ kind: 'integration', file: DINGE, test: 'legt Dinge an', covers: ['angelegt'] }],
    ...overrides,
  });

const catalog = (features: ReturnType<typeof feature>[]): CatalogData => ({
  taxonomy,
  features: features.map((f) => ({ ...f, area: 'lager', file: 'features/lager.yaml' })),
  review: [],
  gaps: [],
});
const codes = (data: CatalogData, d = discovery(), reports?: Parameters<typeof analyze>[2]) => analyze(data, d, reports).findings.map((f) => `${f.level}:${f.code}:${f.subject}`);

describe('Prüfregeln', () => {
  it('verlangt für Katalog-Features mindestens einen Nachweis', () => {
    expect(() => feature({ evidence: [] })).toThrow(/Nachweis/);
  });

  it('meldet nicht zugeordnete Bestandteile nur in katalogisierten Bereichen als Fehler', () => {
    const found = codes(catalog([feature()]));
    expect(found).toContain('fehler:UNASSIGNED:GET /v1/dinge');
    expect(found).toContain('hinweis:AREA_OPEN:rest');
    expect(found.filter((c) => c.includes('GET /v1/rest'))).toEqual([]);
  });

  it('legt nie selbst Features an, sondern meldet nur', () => {
    const data = catalog([feature()]);
    analyze(data, discovery());
    expect(data.features).toHaveLength(1);
  });

  it('meldet Verweise auf Entferntes: Endpunkt, Ereignis, Test, Szenario, Quelle', () => {
    const f = feature({
      technical: { components: ['gibt/es/nicht.ts'], endpoints: ['DELETE /v1/dinge'], events: { emits: ['ding.weg'] } },
      evidence: [
        { kind: 'integration', file: DINGE, test: 'gibt es nicht', covers: ['angelegt'] },
        { kind: 'scenario', id: 'weg-flow', covers: ['angelegt'] },
      ],
    });
    const found = codes(catalog([f])).map((c) => c.split(':')[1]);
    expect(found).toEqual(expect.arrayContaining(['MISSING_SOURCE', 'UNKNOWN_ENDPOINT', 'UNKNOWN_EVENT', 'UNKNOWN_TEST', 'UNKNOWN_SCENARIO']));
  });

  it('kennzeichnet Features, deren Nachweis im Testlauf fehlschlägt oder fehlt', () => {
    const passed = parseJunit('<testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; legt Dinge an"/>');
    const failed = parseJunit('<testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; legt Dinge an"><failure message="x"/></testcase>');
    const other = parseJunit('<testcase classname="test/integration/anderes.test.ts" name="Anderes &gt; etwas"/>');
    const data = catalog([feature()]);
    expect(analyze(data, discovery(), passed).features[0]!.proof).toBe('nachgewiesen');
    expect(analyze(data, discovery()).features[0]!.proof).toBe('statisch');
    expect(analyze(data, discovery(), failed).findings.map((f) => f.code)).toContain('EVIDENCE_FAILED');
    expect(analyze(data, discovery(), other).findings.map((f) => f.code)).toContain('EVIDENCE_NOT_RUN');
    expect(analyze(data, discovery(), failed).features[0]!.proof).toBe('nicht-nachgewiesen');
  });

  it('verlangt für jedes Akzeptanzkriterium einen bestandenen Nachweis', () => {
    const at = 'features/lager.yaml: lager.anlegen';
    // ohne Kriterium und ohne Zuordnung
    const bare = codes(catalog([feature({ acceptance: [], evidence: [{ kind: 'integration', file: DINGE, test: 'legt Dinge an' }] })]));
    expect(bare).toEqual(expect.arrayContaining([`fehler:ACCEPTANCE_MISSING:${at}`, `fehler:EVIDENCE_UNLINKED:${at}`]));
    // Kriterium ohne Nachweis und Verweis auf ein unbekanntes Kriterium
    const twoCriteria = [
      { id: 'angelegt', kind: 'effekt', text: 'Das Ding steht bereit.' },
      { id: 'gemeldet', kind: 'effekt', text: 'Ein Ereignis meldet das Ding.' },
    ];
    const uncovered = analyze(catalog([feature({ acceptance: twoCriteria })]), discovery());
    expect(uncovered.findings.filter((f) => f.code === 'ACCEPTANCE_UNCOVERED').map((f) => f.message)).toEqual(['Kriterium „gemeldet“ hat keinen Nachweis']);
    expect(codes(catalog([feature({ evidence: [{ kind: 'integration', file: DINGE, test: 'legt Dinge an', covers: ['angelegt', 'gibtsnicht'] }] })]))).toContain(`fehler:EVIDENCE_UNLINKED:${at}`);

    // Ein Kriterium bestanden, das andere fehlgeschlagen → teilweise nachgewiesen
    const text = `${DINGE_TEST}\nit('meldet Dinge', async () => { expect((await collector.waitFor((m) => m.topic === 'wms/ding/angelegt')).body).toMatchObject({ name: 'A' }); })`;
    const d = discovery({ testFiles: [{ path: DINGE, text }], callingFiles: [{ path: DINGE, text }] });
    const both = feature({
      acceptance: twoCriteria,
      evidence: [
        { kind: 'integration', file: DINGE, test: 'legt Dinge an', covers: ['angelegt'] },
        { kind: 'integration', file: DINGE, test: 'meldet Dinge', covers: ['gemeldet'] },
      ],
    });
    const run = parseJunit(
      '<testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; legt Dinge an"/>' +
        '<testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; meldet Dinge"><failure message="x"/></testcase>',
    );
    const result = analyze(catalog([both]), d, run).features[0]!;
    expect(result.proof).toBe('teilweise');
    expect(result.acceptance.map((c) => [c.criterion.id, c.status])).toEqual([['angelegt', 'nachgewiesen'], ['gemeldet', 'offen']]);
    const green = parseJunit('<testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; legt Dinge an"/><testcase classname="test/integration/dinge.test.ts" name="Dinge &gt; meldet Dinge"/>');
    expect(analyze(catalog([both]), d, green).features[0]!.proof).toBe('nachgewiesen');
  });

  it('erkennt Nachweise ohne Zusicherung, mit reiner Statusprüfung oder ohne Bezug zum Feature', () => {
    const text = [
      "it('ruft nur auf', async () => { await api.post('/v1/dinge', {}); })",
      "it('prüft nur den Status', async () => { expect((await api.post('/v1/dinge', {})).status).toBe(201); })",
      "it('prüft etwas anderes', async () => { expect((await api.get('/v1/rest')).body).toMatchObject({ name: 'A' }); })",
    ].join('\n');
    const d = discovery({ testFiles: [{ path: DINGE, text }], callingFiles: [{ path: DINGE, text }] });
    const ids: Record<string, string> = { 'ruft nur auf': 'lager.ohne', 'prüft nur den Status': 'lager.status', 'prüft etwas anderes': 'lager.fremd' };
    const ev = (test: string, extra: Record<string, unknown> = {}) => feature({ id: ids[test], evidence: [{ kind: 'integration', file: DINGE, test, covers: ['angelegt'], ...extra }] });
    const found = analyze(catalog([ev('ruft nur auf'), ev('prüft nur den Status'), ev('prüft etwas anderes')]), d).findings.map((f) => `${f.level}:${f.code}:${f.subject.split(': ')[1]}`);
    expect(found).toEqual(expect.arrayContaining(['fehler:EVIDENCE_NO_ASSERTION:lager.ohne', 'warnung:EVIDENCE_STATUS_ONLY:lager.status', 'warnung:EVIDENCE_UNRELATED:lager.fremd']));
    // Ohne Zusicherung trägt der Nachweis das Kriterium nicht
    expect(analyze(catalog([ev('ruft nur auf')]), d).findings.map((f) => f.code)).toContain('ACCEPTANCE_UNCOVERED');
    // Eine Begründung nach Review ersetzt die Warnung, nicht die Zusicherung
    const reviewed = analyze(catalog([ev('prüft etwas anderes', { rationale: 'Prüft den Broker direkt.' })]), d).findings.map((f) => f.code);
    expect(reviewed).not.toContain('EVIDENCE_UNRELATED');
  });

  it('verlangt den Fehlercode einer Regel als Zusicherung im Test', () => {
    const rules = ['Doppelte Namen → 409 `DING_EXISTS`.', 'Zustände `OPEN` → `IN_PROGRESS` → `DONE`.'];
    const at = 'features/lager.yaml: lager.anlegen';
    expect(codes(catalog([feature({ rules })]))).toContain(`fehler:RULE_WITHOUT_ACCEPTANCE:${at}`);
    const acceptance = [
      { id: 'angelegt', kind: 'effekt', text: 'Das Ding steht bereit.' },
      { id: 'eindeutig', kind: 'regel', text: 'Doppelte Namen werden abgelehnt.', code: 'DING_EXISTS' },
    ];
    const evidence = [{ kind: 'integration', file: DINGE, test: 'legt Dinge an', covers: ['angelegt', 'eindeutig'] }];
    const missing = codes(catalog([feature({ rules, acceptance, evidence })]));
    expect(missing).toContain(`fehler:RULE_CODE_NOT_ASSERTED:${at}`);
    expect(missing.filter((c) => c.includes('RULE_WITHOUT_ACCEPTANCE'))).toEqual([]);
    const text = `it('legt Dinge an', async () => { expect(await api.post('/v1/dinge', {})).toMatchObject({ status: 409, body: { code: 'DING_EXISTS' } }); })`;
    const d = discovery({ testFiles: [{ path: DINGE, text }], callingFiles: [{ path: DINGE, text }] });
    expect(codes(catalog([feature({ rules, acceptance, evidence })]), d).filter((c) => /RULE_|ACCEPTANCE_|EVIDENCE_/.test(c))).toEqual([]);
    // Ein Teilwort zählt nicht: `DING_EXISTS` ist nicht in `OTHER_DING_EXISTS` zugesichert
    const partial = text.replace("'DING_EXISTS'", "'OTHER_DING_EXISTS'");
    expect(codes(catalog([feature({ rules, acceptance, evidence })]), discovery({ testFiles: [{ path: DINGE, text: partial }] }))).toContain(`fehler:RULE_CODE_NOT_ASSERTED:${at}`);
  });

  it('warnt, wenn kein Test einen Endpunkt eines Features erkennbar aufruft', () => {
    const found = codes(catalog([feature()]), discovery({ callingFiles: [] }));
    expect(found).toContain('warnung:ENDPOINT_UNTESTED:features/lager.yaml: lager.anlegen');
  });
});

describe('Vergleich mit anderen Systemen', () => {
  const withSystem = (complete: boolean, features: ReturnType<typeof feature>[], gaps: CatalogData['gaps'] = []): CatalogData => ({
    ...catalog(features),
    taxonomy: { ...taxonomy, systems: [{ id: 'altsystem', title: 'Altsystem', description: 'x', complete }] },
    gaps,
  });

  it('verlangt bei vollständigem Vergleich eine Einstufung für jedes Feature', () => {
    expect(codes(withSystem(true, [feature()]))).toContain('fehler:COMPARISON_MISSING:features/lager.yaml: lager.anlegen');
    expect(codes(withSystem(false, [feature()]))).toContain('hinweis:COMPARISON_OPEN:altsystem');
    expect(codes(withSystem(true, [feature({ comparisons: { altsystem: { status: 'erweitert' } } })])).filter((c) => c.includes('COMPARISON'))).toEqual([]);
  });

  it('meldet unbekannte Systeme und Lücken mit falschen Verweisen', () => {
    expect(codes(catalog([feature({ comparisons: { fremd: { status: 'neu' } } })]))).toContain('fehler:UNKNOWN_SYSTEM:features/lager.yaml: lager.anlegen');
    const gap = { id: 'altsystem.druck', title: 'Druck', area: 'gibt-es-nicht', summary: 'x', status: 'fehlt' as const, source: 'oss' as const, refs: [], related: ['lager.weg'], system: 'altsystem', file: 'comparisons/altsystem.yaml' };
    const found = codes(withSystem(false, [feature()], [gap])).map((c) => c.split(':')[1]);
    expect(found).toEqual(expect.arrayContaining(['UNKNOWN_AREA', 'UNKNOWN_DEPENDENCY']));
  });
});

describe('Hilfsfunktionen', () => {
  it('ordnet Pfade nach Präfix zu, ohne Nachbarn mitzunehmen', () => {
    expect(ownsPath('/v1/stock', '/v1/stock/{id}/issues')).toBe(true);
    expect(ownsPath('/v1/stock', '/v1/stock-counts')).toBe(false);
  });

  it('erkennt Aufrufe mit Methode und Parametern, nicht aber bloße Pfadlisten', () => {
    const files = [
      { path: 'a.ts', text: 'await api.post(`/v1/stock/${item.id}/issues`, body)' },
      { path: 'b.js', text: "{ method: 'GET', path: `/v1/stock/summary?by=location` }" },
      { path: 'c.ts', text: "expect(paths).toEqual(['/v1/stock/{id}/issues'])" },
      { path: 'd.ts', text: "await api.get('/v1/stock-counts')" },
      { path: 'e.ts', text: "await api.post(`/v1/movements/${mv['P1']}/release`)" },
      { path: 'f.ts', text: 'await fetch(`${baseUrl}/v1/events/stream?types=x`, { headers })' },
    ];
    expect(filesCalling({ method: 'POST', path: '/v1/stock/{id}/issues' }, files)).toEqual(['a.ts']);
    expect(filesCalling({ method: 'GET', path: '/v1/stock/summary' }, files)).toEqual(['b.js']);
    expect(filesCalling({ method: 'GET', path: '/v1/stock' }, files)).toEqual([]);
    expect(filesCalling({ method: 'POST', path: '/v1/movements/{number}/release' }, files)).toEqual(['e.ts']);
    expect(filesCalling({ method: 'GET', path: '/v1/events/stream' }, files)).toEqual(['f.ts']);
  });

  it('findet Testtitel als String-Literal', () => {
    expect(containsTitle("it('hebt eine Reservierung auf', …)", 'hebt eine Reservierung auf')).toBe(true);
    expect(containsTitle("it('hebt eine Reservierung auf und mehr', …)", 'hebt eine Reservierung auf')).toBe(false);
  });

  it('ordnet Szenarien und Browser-Tests ihren Berichten zu', () => {
    const tests = [
      ...parseJunit('<testcase classname="test/scenarios.test.ts" name="Node-RED-Szenarien &gt; stock-flow – Bestand: …"/>'),
      ...parseJunit('<testcase name="Bestand zeigt Posten" classname="leitstand.spec.ts"><skipped/></testcase>'),
    ];
    expect(resultOf({ kind: 'scenario', id: 'stock-flow', covers: [] }, tests)).toBe('bestanden');
    expect(resultOf({ kind: 'web-e2e', file: 'apps/web/e2e/leitstand.spec.ts', test: 'Bestand zeigt Posten', covers: [] }, tests)).toBe('uebersprungen');
  });

  it('leitet Rollen aus der Rechtetabelle der API ab', () => {
    expect(accessOf('POST', '/v1/stock/{id}/issues')).toEqual({ kind: 'roles', roles: ['admin', 'leitstand', 'lager'] });
    expect(accessOf('GET', '/v1/stock').kind).toBe('authenticated');
    expect(accessOf('POST', '/v1/auth/login').kind).toBe('public');
  });
});
