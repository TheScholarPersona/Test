/**
 * Prüft den Katalog gegen den Code und reichert ihn für die Ansicht an.
 *
 * Fehler (CI rot):
 * - Verweise ins Leere: Endpunkt, Ereignis, Route, Node, Quelldatei, Szenario oder Test gibt es nicht (mehr)
 * - Katalog-Feature, dessen Nachweis im Testlauf fehlschlägt oder fehlt
 * - Bestandteil eines katalogisierten Bereichs, der keinem Feature, Prüfbestand-Eintrag oder Ausnahme zugeordnet ist
 * Warnungen: Endpunkt eines Features, den kein Test erkennbar aufruft (Heuristik); Bestandteile ohne zuständigen Bereich
 * Hinweise: offene Bereiche (Anzahl nicht zugeordneter Bestandteile)
 *
 * Neue Features legt die Prüfung nie an – sie meldet nur, was zugeordnet werden muss.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { containsTitle, type Discovery, filesCalling } from './discover.ts';
import { coveredKinds, type ReportedTest, resultOf, type TestResult } from './junit.ts';
import type { CatalogData } from './load.ts';
import { accessOf, type EndpointAccess } from './roles.ts';
import type { Area, Evidence, Feature, ReviewItem } from './schema.ts';

export type Level = 'fehler' | 'warnung' | 'hinweis';

export interface Finding {
  level: Level;
  code: string;
  message: string;
  /** Betroffener Eintrag oder Bestandteil. */
  subject: string;
}

export const ITEM_KINDS = ['endpoints', 'events', 'uiRoutes', 'nodeRedNodes'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_LABELS: Record<ItemKind, string> = { endpoints: 'Endpunkt', events: 'Ereignis', uiRoutes: 'Route', nodeRedNodes: 'Node-RED-Node' };

/** Nachweisstatus eines Features. */
export type ProofStatus = 'nachgewiesen' | 'statisch' | 'nicht-nachgewiesen';

export interface EnrichedEvidence {
  evidence: Evidence;
  exists: boolean;
  result?: TestResult | 'nicht-ausgefuehrt';
}

export interface EnrichedEndpoint {
  ref: string;
  summary: string;
  tags: string[];
  access: EndpointAccess;
  /** Testdateien, die den Endpunkt aufrufen (Heuristik). */
  calledBy: string[];
}

type Entry = (Feature | ReviewItem) & { file: string };

export interface EnrichedEntry {
  entry: Entry;
  area: string;
  /** Rollen, die die Funktion ausführen dürfen (aus der Rechtetabelle der API abgeleitet). */
  roles: string[];
  channels: string[];
  endpoints: EnrichedEndpoint[];
  evidence: EnrichedEvidence[];
  proof: ProofStatus;
}

export interface AreaCoverage {
  area: Area;
  items: { kind: ItemKind; ref: string; assignedTo: string[]; excluded?: string }[];
}

export interface Analysis {
  findings: Finding[];
  features: EnrichedEntry[];
  review: EnrichedEntry[];
  coverage: AreaCoverage[];
  unowned: { kind: ItemKind; ref: string }[];
  /** Nachweisarten, für die Testberichte vorlagen. */
  reportedKinds: Evidence['kind'][];
}

/** `/v1/stock` passt auf `/v1/stock` und `/v1/stock/…`, nicht auf `/v1/stock-counts`. */
export function ownsPath(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function owner(areas: Area[], kind: ItemKind, ref: string): Area | undefined {
  let best: { area: Area; length: number } | undefined;
  for (const area of areas) {
    for (const prefix of area.owns[kind]) {
      const value = kind === 'endpoints' ? ref.slice(ref.indexOf(' ') + 1) : ref;
      const hit =
        kind === 'endpoints' || kind === 'uiRoutes'
          ? ownsPath(prefix, value)
          : kind === 'events'
            ? value === prefix || value.startsWith(`${prefix}.`)
            : value === prefix;
      if (hit && (!best || prefix.length > best.length)) best = { area, length: prefix.length };
    }
  }
  return best?.area;
}

export function analyze(data: CatalogData, discovery: Discovery, reports?: ReportedTest[]): Analysis {
  const findings: Finding[] = [];
  const add = (level: Level, code: string, subject: string, message: string) => findings.push({ level, code, subject, message });
  const { taxonomy } = data;
  const areas = new Map(taxonomy.areas.map((a) => [a.id, a]));
  const groups = new Map(taxonomy.areas.flatMap((a) => a.groups.map((g) => [g.id, a.id] as const)));
  const reportedKinds = reports ? coveredKinds(reports) : new Set<Evidence['kind']>();

  // --- Taxonomie ---------------------------------------------------------------
  const seenTaxonomy = new Set<string>();
  for (const area of taxonomy.areas) {
    for (const id of [area.id, ...area.groups.map((g) => g.id)]) {
      if (seenTaxonomy.has(id)) add('fehler', 'DUPLICATE_ID', id, 'Kennung in der Taxonomie mehrfach vergeben');
      seenTaxonomy.add(id);
    }
    for (const group of area.groups) {
      if (!group.id.startsWith(`${area.id}.`)) add('fehler', 'GROUP_PREFIX', group.id, `Gruppen-Kennung muss mit „${area.id}.“ beginnen`);
    }
  }

  // --- Einträge ------------------------------------------------------------------
  const all: { entry: Entry; area: string; isFeature: boolean }[] = [
    ...data.features.map((f) => ({ entry: f, area: f.area, isFeature: true })),
    ...data.review.map((r) => ({ entry: r, area: groups.get(r.group) ?? r.id.split('.')[0]!, isFeature: false })),
  ];
  const ids = new Set<string>();
  for (const { entry } of all) {
    if (ids.has(entry.id)) add('fehler', 'DUPLICATE_ID', entry.id, 'Kennung mehrfach vergeben (Katalog und Prüfbestand zusammen)');
    ids.add(entry.id);
  }

  const enrich = ({ entry, area, isFeature }: (typeof all)[number]): EnrichedEntry => {
    const where = `${entry.file}: ${entry.id}`;
    if (!areas.has(area)) add('fehler', 'UNKNOWN_AREA', where, `Bereich „${area}“ fehlt in catalog.yaml`);
    if (!entry.id.startsWith(`${area}.`)) add('fehler', 'ID_PREFIX', where, `Kennung muss mit „${area}.“ beginnen`);
    if (groups.get(entry.group) !== area) add('fehler', 'UNKNOWN_GROUP', where, `Gruppe „${entry.group}“ gibt es im Bereich „${area}“ nicht`);
    for (const dep of entry.dependsOn) if (!ids.has(dep)) add('fehler', 'UNKNOWN_DEPENDENCY', where, `Abhängigkeit „${dep}“ gibt es nicht`);

    const t = entry.technical;
    for (const c of t.components) if (!existsSync(join(discovery.root, c))) add('fehler', 'MISSING_SOURCE', where, `Quelle „${c}“ gibt es nicht (mehr)`);
    for (const e of [...t.events.emits, ...t.events.consumes]) if (!discovery.events.has(e)) add('fehler', 'UNKNOWN_EVENT', where, `Ereignis „${e}“ gibt es nicht (mehr)`);
    for (const r of t.uiRoutes) if (!discovery.uiRoutes.has(r)) add('fehler', 'UNKNOWN_ROUTE', where, `Route „${r}“ gibt es nicht (mehr)`);
    for (const n of t.nodeRedNodes) if (!discovery.nodeRedNodes.has(n)) add('fehler', 'UNKNOWN_NODE', where, `Node-RED-Node „${n}“ gibt es nicht (mehr)`);

    const endpoints: EnrichedEndpoint[] = [];
    for (const ref of t.endpoints) {
      const found = discovery.endpoints.get(ref);
      if (!found) {
        add('fehler', 'UNKNOWN_ENDPOINT', where, `Endpunkt „${ref}“ gibt es nicht (mehr) – Verfügbarkeit nicht nachgewiesen`);
        continue;
      }
      const calledBy = filesCalling(found, discovery.callingFiles);
      if (isFeature && calledBy.length === 0) {
        add('warnung', 'ENDPOINT_UNTESTED', where, `Kein Test ruft „${ref}“ auf – Test ergänzen oder den Endpunkt in den Prüfbestand verschieben`);
      }
      endpoints.push({ ref, summary: found.summary, tags: found.tags, access: accessOf(found.method, found.path), calledBy });
    }

    const evidence: EnrichedEvidence[] = entry.evidence.map((ev) => {
      let exists: boolean;
      if (ev.kind === 'scenario') {
        exists = discovery.scenarios.has(ev.id);
        if (!exists) add('fehler', 'UNKNOWN_SCENARIO', where, `Szenario „${ev.id}“ gibt es nicht (mehr)`);
      } else {
        const file = discovery.testFiles.find((f) => f.path === ev.file);
        exists = !!file && containsTitle(file.text, ev.test);
        if (!file) add('fehler', 'UNKNOWN_TEST_FILE', where, `Testdatei „${ev.file}“ gibt es nicht (mehr)`);
        else if (!exists) add('fehler', 'UNKNOWN_TEST', where, `Test „${ev.test}“ steht nicht (mehr) in ${ev.file}`);
      }
      const enriched: EnrichedEvidence = { evidence: ev, exists };
      if (reports && reportedKinds.has(ev.kind)) enriched.result = resultOf(ev, reports) ?? 'nicht-ausgefuehrt';
      return enriched;
    });

    let proof: ProofStatus = evidence.length > 0 && evidence.every((e) => e.exists) ? 'statisch' : 'nicht-nachgewiesen';
    const executed = evidence.filter((e) => e.result !== undefined);
    if (proof === 'statisch' && executed.length > 0) {
      // Übersprungen zählt wie nicht ausgeführt: belegt ist nur, was im Lauf bestanden hat.
      const bad = executed.filter((e) => e.result !== 'bestanden');
      if (bad.length > 0) proof = 'nicht-nachgewiesen';
      else if (executed.length === evidence.length) proof = 'nachgewiesen';
      if (isFeature) {
        for (const e of bad) {
          const name = e.evidence.kind === 'scenario' ? `Szenario ${e.evidence.id}` : `„${e.evidence.test}“`;
          const what = { fehlgeschlagen: 'ist fehlgeschlagen', uebersprungen: 'wurde übersprungen', 'nicht-ausgefuehrt': 'kam im Testlauf nicht vor' }[e.result as string];
          const code = { fehlgeschlagen: 'EVIDENCE_FAILED', uebersprungen: 'EVIDENCE_SKIPPED', 'nicht-ausgefuehrt': 'EVIDENCE_NOT_RUN' }[e.result as string]!;
          add('fehler', code, where, `Nachweis ${name} ${what} – Verfügbarkeit nicht nachgewiesen`);
        }
      }
    }

    // Wer die Funktion ausführen darf: die Rollen der ändernden Endpunkte; reine Lesefunktionen nach den Leseendpunkten.
    const writing = endpoints.filter((e) => !e.ref.startsWith('GET '));
    const roles = [...new Set((writing.length ? writing : endpoints).flatMap((e) => e.access.roles))];
    const channels = [...new Set(entry.usage.map((u) => u.channel))];
    return { entry, area, roles, channels, endpoints, evidence, proof };
  };

  const enriched = all.map((item) => ({ item, result: enrich(item) }));
  const features = enriched.filter((e) => e.item.isFeature).map((e) => e.result);
  const review = enriched.filter((e) => !e.item.isFeature).map((e) => e.result);

  // --- Zuordnung der erkannten Bestandteile -----------------------------------------
  const discovered: Record<ItemKind, string[]> = {
    endpoints: [...discovery.endpoints.keys()],
    events: [...discovery.events],
    uiRoutes: [...discovery.uiRoutes],
    nodeRedNodes: [...discovery.nodeRedNodes],
  };
  const exclusions = new Map<string, string>();
  for (const kind of ITEM_KINDS) {
    for (const ex of taxonomy.exclusions[kind]) {
      exclusions.set(`${kind}:${ex.ref}`, ex.reason);
      if (!discovered[kind].includes(ex.ref)) add('fehler', 'UNKNOWN_EXCLUSION', `catalog.yaml: ${ex.ref}`, `Ausnahme verweist auf einen ${ITEM_LABELS[kind]}, den es nicht (mehr) gibt`);
    }
  }
  const assigned = new Map<string, string[]>();
  for (const { entry } of all) {
    const t = entry.technical;
    const refs: [ItemKind, string[]][] = [
      ['endpoints', t.endpoints],
      ['events', [...t.events.emits, ...t.events.consumes]],
      ['uiRoutes', t.uiRoutes],
      ['nodeRedNodes', t.nodeRedNodes],
    ];
    for (const [kind, list] of refs) for (const ref of list) assigned.set(`${kind}:${ref}`, [...(assigned.get(`${kind}:${ref}`) ?? []), entry.id]);
  }

  const coverage = new Map<string, AreaCoverage>(taxonomy.areas.map((a) => [a.id, { area: a, items: [] }]));
  const unowned: Analysis['unowned'] = [];
  for (const kind of ITEM_KINDS) {
    for (const ref of discovered[kind].sort()) {
      const area = owner(taxonomy.areas, kind, ref);
      const key = `${kind}:${ref}`;
      const excluded = exclusions.get(key);
      if (!area) {
        unowned.push({ kind, ref });
        add('warnung', 'UNOWNED', ref, `${ITEM_LABELS[kind]} ist keinem Bereich zugeordnet (owns in catalog.yaml ergänzen)`);
        continue;
      }
      const assignedTo = assigned.get(key) ?? [];
      coverage.get(area.id)!.items.push({ kind, ref, assignedTo, ...(excluded ? { excluded } : {}) });
      if (assignedTo.length === 0 && !excluded && area.status === 'katalogisiert') {
        add('fehler', 'UNASSIGNED', ref, `${ITEM_LABELS[kind]} im katalogisierten Bereich „${area.title}“ ist keinem Feature und keinem Prüfbestand-Eintrag zugeordnet`);
      }
    }
  }
  for (const c of coverage.values()) {
    const open = c.items.filter((i) => i.assignedTo.length === 0 && !i.excluded).length;
    if (c.area.status === 'offen' && open > 0) add('hinweis', 'AREA_OPEN', c.area.id, `Bereich „${c.area.title}“ ist noch nicht katalogisiert: ${open} von ${c.items.length} Bestandteilen nicht zugeordnet`);
  }

  return { findings, features, review, coverage: [...coverage.values()], unowned, reportedKinds: [...reportedKinds] };
}
