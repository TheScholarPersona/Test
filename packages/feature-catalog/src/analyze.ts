/**
 * Prüft den Katalog gegen den Code und reichert ihn für die Ansicht an.
 *
 * Fehler (CI rot):
 * - Verweise ins Leere: Endpunkt, Ereignis, Route, Node, Quelldatei, Szenario oder Test gibt es nicht (mehr)
 * - Katalog-Feature, dessen Nachweis im Testlauf fehlschlägt oder fehlt
 * - Bestandteil eines katalogisierten Bereichs, der keinem Feature, Prüfbestand-Eintrag oder Ausnahme zugeordnet ist
 * - Nachweisregeln: Feature ohne Akzeptanzkriterium der Art effekt, Fehlercode ohne Regel-Kriterium, Nachweis ohne
 *   `covers`, Test ohne Zusicherung, Regel-Code nicht im abdeckenden Test, Kriterium ohne (bestandenen) Nachweis
 * Warnungen: Endpunkt eines Features, den kein Test erkennbar aufruft (Heuristik); Bestandteile ohne zuständigen Bereich;
 *   Nachweis, der nur Status/Existenz zusichert oder keinen Bestandteil des Features berührt (Review nötig)
 * Hinweise: offene Bereiche (Anzahl nicht zugeordneter Bestandteile)
 *
 * Neue Features legt die Prüfung nie an – sie meldet nur, was zugeordnet werden muss.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { containsTitle, type Discovery, filesCalling } from './discover.ts';
import { assess, codesIn, type EvidenceQuality, scenarioBlock, testBlock } from './evidence-quality.ts';
import { coveredKinds, type ReportedTest, resultOf, type TestResult } from './junit.ts';
import type { CatalogData } from './load.ts';
import { accessOf, type EndpointAccess } from './roles.ts';
import type { Acceptance, Area, Evidence, Feature, ReviewItem } from './schema.ts';

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

/**
 * Nachweisstatus eines Features: `nachgewiesen` = jedes Akzeptanzkriterium hat einen inhaltlich passenden Nachweis,
 * der im Testlauf bestanden hat; `statisch` = ebenso, aber ohne Testberichte; `teilweise` = nur ein Teil der Kriterien.
 */
export type ProofStatus = 'nachgewiesen' | 'statisch' | 'teilweise' | 'nicht-nachgewiesen';
export type CriterionStatus = 'nachgewiesen' | 'statisch' | 'offen';

export interface EnrichedEvidence {
  evidence: Evidence;
  exists: boolean;
  result?: TestResult | 'nicht-ausgefuehrt';
  /** Inhaltliche Beurteilung des Testkörpers (Heuristik). */
  quality: Omit<EvidenceQuality, 'text'>;
}

export interface EnrichedCriterion {
  criterion: Acceptance;
  status: CriterionStatus;
  /** Indizes der Nachweise, die das Kriterium abdecken. */
  coveredBy: number[];
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
  acceptance: EnrichedCriterion[];
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

    const refs = {
      endpoints: t.endpoints.map((r) => ({ method: r.slice(0, r.indexOf(' ')), path: r.slice(r.indexOf(' ') + 1) })),
      events: [...t.events.emits, ...t.events.consumes],
      uiRoutes: t.uiRoutes,
      nodeRedNodes: t.nodeRedNodes,
      components: t.components,
    };
    const level = isFeature ? 'fehler' : 'hinweis';
    const criteria = new Map(entry.acceptance.map((c) => [c.id, c]));
    if (criteria.size !== entry.acceptance.length) add('fehler', 'DUPLICATE_ID', where, 'Kennung eines Akzeptanzkriteriums mehrfach vergeben');
    if (isFeature && !entry.acceptance.some((c) => c.kind === 'effekt')) add('fehler', 'ACCEPTANCE_MISSING', where, 'Kein Akzeptanzkriterium der Art „effekt“ – was bewirkt die Funktion beobachtbar?');
    const ruleCodes = new Set(entry.acceptance.filter((c) => c.kind === 'regel' && c.code).map((c) => c.code!));
    for (const code of codesIn(entry.rules)) {
      if (!ruleCodes.has(code)) add(level, 'RULE_WITHOUT_ACCEPTANCE', where, `Fehlercode \`${code}\` aus den Regeln hat kein Akzeptanzkriterium der Art „regel“`);
    }

    const texts: string[] = [];
    const evidence: EnrichedEvidence[] = entry.evidence.map((ev) => {
      let exists: boolean;
      let block: string | undefined;
      let fileText = '';
      if (ev.kind === 'scenario') {
        exists = discovery.scenarios.has(ev.id);
        if (!exists) add('fehler', 'UNKNOWN_SCENARIO', where, `Szenario „${ev.id}“ gibt es nicht (mehr)`);
        for (const f of discovery.testFiles.filter((x) => x.path.startsWith('flows/scenarios/'))) {
          block = scenarioBlock(f.text, ev.id);
          if (block) {
            fileText = f.text;
            break;
          }
        }
      } else {
        const file = discovery.testFiles.find((f) => f.path === ev.file);
        exists = !!file && containsTitle(file.text, ev.test);
        if (!file) add('fehler', 'UNKNOWN_TEST_FILE', where, `Testdatei „${ev.file}“ gibt es nicht (mehr)`);
        else if (!exists) add('fehler', 'UNKNOWN_TEST', where, `Test „${ev.test}“ steht nicht (mehr) in ${ev.file}`);
        if (file && exists) {
          fileText = file.text;
          block = testBlock(file.text, ev.test);
        }
      }
      const { text, ...quality } = assess(fileText, block, refs);
      texts.push(text);
      const name = ev.kind === 'scenario' ? `Szenario ${ev.id}` : `„${ev.test}“`;
      if (ev.covers.length === 0) add(level, 'EVIDENCE_UNLINKED', where, `Nachweis ${name} nennt kein Akzeptanzkriterium (covers)`);
      for (const c of ev.covers) if (!criteria.has(c)) add('fehler', 'EVIDENCE_UNLINKED', where, `Nachweis ${name} verweist auf unbekanntes Kriterium „${c}“`);
      if (exists && quality.found) {
        if (quality.assertions === 0) add(level, 'EVIDENCE_NO_ASSERTION', where, `Nachweis ${name} enthält keine Zusicherung`);
        else if (quality.statusOnly && isFeature && !ev.rationale) add('warnung', 'EVIDENCE_STATUS_ONLY', where, `Nachweis ${name} sichert nur Status oder Existenz zu – prüft er den Effekt?`);
        if (!quality.related && isFeature && !ev.rationale) add('warnung', 'EVIDENCE_UNRELATED', where, `Nachweis ${name} berührt keinen Endpunkt, kein Ereignis, keine Seite und keine Komponente des Features`);
      }
      const enriched: EnrichedEvidence = { evidence: ev, exists, quality };
      if (reports && reportedKinds.has(ev.kind)) enriched.result = resultOf(ev, reports) ?? 'nicht-ausgefuehrt';
      return enriched;
    });

    if (isFeature) {
      for (const e of evidence) {
        if (e.result === undefined || e.result === 'bestanden') continue;
        const name = e.evidence.kind === 'scenario' ? `Szenario ${e.evidence.id}` : `„${e.evidence.test}“`;
        const what = { fehlgeschlagen: 'ist fehlgeschlagen', uebersprungen: 'wurde übersprungen', 'nicht-ausgefuehrt': 'kam im Testlauf nicht vor' }[e.result];
        const code = { fehlgeschlagen: 'EVIDENCE_FAILED', uebersprungen: 'EVIDENCE_SKIPPED', 'nicht-ausgefuehrt': 'EVIDENCE_NOT_RUN' }[e.result];
        add('fehler', code, where, `Nachweis ${name} ${what} – Verfügbarkeit nicht nachgewiesen`);
      }
    }

    // Ein Nachweis trägt ein Kriterium, wenn es ihn gibt und er etwas zusichert (oder nicht beurteilbar ist, z. B. ein
    // Szenario-Tab ohne Schrittliste); belegt ist das Kriterium erst, wenn ein solcher Nachweis bestanden hat.
    const usable = (e: EnrichedEvidence) => e.exists && (!e.quality.found || e.quality.assertions > 0);
    const acceptance: EnrichedCriterion[] = entry.acceptance.map((criterion) => {
      const coveredBy = evidence.map((e, i) => (e.evidence.covers.includes(criterion.id) ? i : -1)).filter((i) => i >= 0);
      const valid = coveredBy.filter((i) => usable(evidence[i]!));
      let status: CriterionStatus = 'offen';
      if (valid.some((i) => evidence[i]!.result === 'bestanden')) status = 'nachgewiesen';
      else if (valid.some((i) => evidence[i]!.result === undefined)) status = 'statisch';
      if (coveredBy.length === 0) add(level, 'ACCEPTANCE_UNCOVERED', where, `Kriterium „${criterion.id}“ hat keinen Nachweis`);
      else if (status === 'offen') add(level, 'ACCEPTANCE_UNCOVERED', where, `Kriterium „${criterion.id}“ hat keinen gültigen, bestandenen Nachweis`);
      if (criterion.kind === 'regel' && criterion.code && coveredBy.length > 0 && !coveredBy.some((i) => new RegExp(`\\b${criterion.code}\\b`).test(texts[i]!))) {
        add(level, 'RULE_CODE_NOT_ASSERTED', where, `Fehlercode \`${criterion.code}\` von Kriterium „${criterion.id}“ kommt in keinem abdeckenden Test vor`);
      }
      return { criterion, status, coveredBy };
    });

    // nachgewiesen: alle Kriterien bestanden; statisch: alle belegt, aber nicht alle im Lauf; teilweise: einige offen.
    let proof: ProofStatus;
    const open = acceptance.filter((c) => c.status === 'offen').length;
    if (acceptance.length === 0 || open === acceptance.length) proof = 'nicht-nachgewiesen';
    else if (open > 0 || evidence.some((e) => !e.exists)) proof = 'teilweise';
    else if (acceptance.every((c) => c.status === 'nachgewiesen')) proof = 'nachgewiesen';
    else proof = 'statisch';

    // Wer die Funktion ausführen darf: die Rollen der ändernden Endpunkte; reine Lesefunktionen nach den Leseendpunkten.
    const writing = endpoints.filter((e) => !e.ref.startsWith('GET '));
    const roles = [...new Set((writing.length ? writing : endpoints).flatMap((e) => e.access.roles))];
    const channels = [...new Set(entry.usage.map((u) => u.channel))];
    return { entry, area, roles, channels, endpoints, evidence, acceptance, proof };
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

  // --- Vergleich mit anderen Systemen ------------------------------------------------
  const systems = new Map(taxonomy.systems.map((s) => [s.id, s]));
  for (const { entry } of all) {
    for (const system of Object.keys(entry.comparisons)) {
      if (!systems.has(system)) add('fehler', 'UNKNOWN_SYSTEM', `${entry.file}: ${entry.id}`, `Vergleichssystem „${system}“ fehlt unter systems in catalog.yaml`);
    }
  }
  for (const system of taxonomy.systems) {
    const missing = data.features.filter((f) => !f.comparisons[system.id]);
    if (system.complete) for (const f of missing) add('fehler', 'COMPARISON_MISSING', `${f.file}: ${f.id}`, `Einstufung gegenüber ${system.title} fehlt (Vergleich ist als vollständig markiert)`);
    else if (missing.length > 0) add('hinweis', 'COMPARISON_OPEN', system.id, `${missing.length} Features noch ohne Einstufung gegenüber ${system.title}`);
  }
  const gapIds = new Set<string>();
  for (const gap of data.gaps) {
    const where = `${gap.file}: ${gap.id}`;
    if (!systems.has(gap.system)) add('fehler', 'UNKNOWN_SYSTEM', where, `Vergleichssystem „${gap.system}“ fehlt unter systems in catalog.yaml`);
    if (!gap.id.startsWith(`${gap.system}.`)) add('fehler', 'ID_PREFIX', where, `Kennung muss mit „${gap.system}.“ beginnen`);
    if (gapIds.has(gap.id) || ids.has(gap.id)) add('fehler', 'DUPLICATE_ID', where, 'Kennung mehrfach vergeben');
    gapIds.add(gap.id);
    if (!areas.has(gap.area)) add('fehler', 'UNKNOWN_AREA', where, `Bereich „${gap.area}“ fehlt in catalog.yaml`);
    for (const r of gap.related) if (!ids.has(r)) add('fehler', 'UNKNOWN_DEPENDENCY', where, `Verwandtes Feature „${r}“ gibt es nicht`);
  }

  return { findings, features, review, coverage: [...coverage.values()], unowned, reportedKinds: [...reportedKinds] };
}
