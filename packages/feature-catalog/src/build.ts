/**
 * Erzeugt die interaktive Katalogansicht: eine eigenständige HTML-Datei (ohne Server, ohne externe
 * Abhängigkeiten) plus catalog.json mit denselben angereicherten Daten. Beides ist abgeleitet und
 * gehört nicht ins Repository (catalog/dist steht in .gitignore).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Analysis, type EnrichedEntry, ITEM_LABELS } from './analyze.ts';
import type { CatalogData } from './load.ts';
import type { ReviewItem } from './schema.ts';

const viewerDir = new URL('../viewer/', import.meta.url);

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function entryView(e: EnrichedEntry, usedBy: Map<string, string[]>) {
  const { entry } = e;
  const review = 'state' in entry ? (entry as ReviewItem) : undefined;
  return {
    id: entry.id,
    title: entry.title,
    area: e.area,
    group: entry.group,
    summary: entry.summary,
    description: entry.description,
    usage: entry.usage,
    rules: entry.rules,
    settings: entry.settings,
    dependsOn: entry.dependsOn,
    usedBy: usedBy.get(entry.id) ?? [],
    roles: e.roles,
    channels: e.channels,
    proof: e.proof,
    source: entry.file,
    technical: {
      components: entry.technical.components,
      endpoints: e.endpoints,
      events: entry.technical.events,
      uiRoutes: entry.technical.uiRoutes,
      nodeRedNodes: entry.technical.nodeRedNodes,
      notes: entry.technical.notes,
    },
    evidence: e.evidence.map((ev) => ({ ...ev.evidence, exists: ev.exists, result: ev.result ?? null })),
    comparisons: entry.comparisons,
    ...(review ? { state: review.state, reason: review.reason } : {}),
  };
}

export function viewModel(analysis: Analysis, data: CatalogData) {
  const all = [...analysis.features, ...analysis.review];
  const usedBy = new Map<string, string[]>();
  for (const e of all) for (const dep of e.entry.dependsOn) usedBy.set(dep, [...(usedBy.get(dep) ?? []), e.entry.id]);

  return {
    generatedAt: new Date().toISOString(),
    commit: commit(),
    reportedKinds: analysis.reportedKinds,
    itemLabels: ITEM_LABELS,
    areas: analysis.coverage.map((c) => {
      const open = c.items.filter((i) => i.assignedTo.length === 0 && !i.excluded);
      return {
        id: c.area.id,
        title: c.area.title,
        summary: c.area.summary,
        status: c.area.status,
        groups: c.area.groups,
        coverage: {
          total: c.items.length,
          assigned: c.items.filter((i) => i.assignedTo.length > 0).length,
          excluded: c.items.filter((i) => i.excluded).length,
          open: open.map((i) => ({ kind: i.kind, ref: i.ref })),
        },
      };
    }),
    exclusions: data.taxonomy.exclusions,
    features: analysis.features.map((e) => entryView(e, usedBy)),
    review: analysis.review.map((e) => entryView(e, usedBy)),
    unowned: analysis.unowned,
    findings: analysis.findings.filter((f) => f.level !== 'hinweis'),
  };
}

export function buildView(analysis: Analysis, data: CatalogData, outDir: string): void {
  const model = viewModel(analysis, data);
  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(model, null, 2);
  writeFileSync(join(outDir, 'catalog.json'), `${json}\n`);
  const template = readFileSync(new URL('index.html', viewerDir), 'utf8');
  const script = readFileSync(new URL('app.js', viewerDir), 'utf8');
  // `</` im eingebetteten JSON/Skript würde das <script>-Element vorzeitig beenden.
  const html = template
    .replace('/*__CATALOG_DATA__*/', () => JSON.stringify(model).replace(/</g, '\\u003c'))
    .replace('/*__CATALOG_APP__*/', () => script.replace(/<\/script/gi, '<\\/script'));
  writeFileSync(join(outDir, 'index.html'), html);
}
