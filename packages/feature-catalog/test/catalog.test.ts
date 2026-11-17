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
    testFiles: [{ path: 'apps/api/test/integration/dinge.test.ts', text: "it('legt Dinge an', () => api.post('/v1/dinge', {}))" }],
    callingFiles: [{ path: 'apps/api/test/integration/dinge.test.ts', text: "it('legt Dinge an', () => api.post('/v1/dinge', {}))" }],
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
    evidence: [{ kind: 'integration', file: 'apps/api/test/integration/dinge.test.ts', test: 'legt Dinge an' }],
    ...overrides,
  });

const catalog = (features: ReturnType<typeof feature>[]): CatalogData => ({
  taxonomy,
  features: features.map((f) => ({ ...f, area: 'lager', file: 'features/lager.yaml' })),
  review: [],
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
        { kind: 'integration', file: 'apps/api/test/integration/dinge.test.ts', test: 'gibt es nicht' },
        { kind: 'scenario', id: 'weg-flow' },
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

  it('warnt, wenn kein Test einen Endpunkt eines Features erkennbar aufruft', () => {
    const found = codes(catalog([feature()]), discovery({ callingFiles: [] }));
    expect(found).toContain('warnung:ENDPOINT_UNTESTED:features/lager.yaml: lager.anlegen');
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
    ];
    expect(filesCalling({ method: 'POST', path: '/v1/stock/{id}/issues' }, files)).toEqual(['a.ts']);
    expect(filesCalling({ method: 'GET', path: '/v1/stock/summary' }, files)).toEqual(['b.js']);
    expect(filesCalling({ method: 'GET', path: '/v1/stock' }, files)).toEqual([]);
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
    expect(resultOf({ kind: 'scenario', id: 'stock-flow' }, tests)).toBe('bestanden');
    expect(resultOf({ kind: 'web-e2e', file: 'apps/web/e2e/leitstand.spec.ts', test: 'Bestand zeigt Posten' }, tests)).toBe('uebersprungen');
  });

  it('leitet Rollen aus der Rechtetabelle der API ab', () => {
    expect(accessOf('POST', '/v1/stock/{id}/issues')).toEqual({ kind: 'roles', roles: ['admin', 'leitstand', 'lager'] });
    expect(accessOf('GET', '/v1/stock').kind).toBe('authenticated');
    expect(accessOf('POST', '/v1/auth/login').kind).toBe('public');
  });
});
