/**
 * Datenmodell des Feature-Katalogs. Die Daten liegen als YAML unter /catalog:
 *
 *   catalog/catalog.yaml       Taxonomie: Funktionsbereiche, Feature-Gruppen, technische Ausnahmen
 *   catalog/features/*.yaml    Katalog: nachweislich verfügbare Features, eine Datei je Bereich
 *   catalog/review.yaml        Prüfbestand: vorhanden, aber unvollständig, deaktiviert oder nicht nachgewiesen
 *
 * Was sich aus dem Code ableiten lässt (Rollen je Endpunkt, Beschreibung der Endpunkte,
 * Testergebnisse), steht hier bewusst nicht drin – der Katalog verweist nur und wird beim Prüfen
 * und Erzeugen der Ansicht angereichert. So gibt es keinen zweiten Datenbestand.
 */
import { z } from 'zod';

/** Stabile Kennung: klein, mit Bindestrichen, Bereichs-Präfix durch Punkt getrennt (`bestand.reservierung`). */
const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/, 'Kennung: klein, Bindestriche, Punkte (z. B. bestand.reservierung)');
const Text = z.string().trim().min(1);

/** Bedienwege, über die eine Funktion erreichbar ist. */
/** Bedienwege; `entwicklung` = Kommandozeile und CI (z. B. der Katalog selbst). */
export const CHANNELS = ['leitstand', 'scanner', 'api', 'node-red', 'mqtt', 'entwicklung'] as const;
export const Channel = z.enum(CHANNELS);

/** Endpunkt wie in OpenAPI: `METHODE /pfad/{parameter}`. */
export const EndpointRef = z.string().regex(/^(GET|POST|PUT|PATCH|DELETE) \/\S*$/, 'Endpunkt als "METHODE /pfad", z. B. "POST /v1/stock/{id}/issues"');

/** Nachweis: Test oder Szenario, das die Funktion prüft. Die Prüfung stellt sicher, dass es ihn gibt. */
export const Evidence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scenario'), id: Id, note: Text.optional() }).strict(),
  z
    .object({
      kind: z.enum(['unit', 'integration', 'web-e2e']),
      file: Text,
      /** Titel des Tests (`it`/`test`), wörtlich wie im Quelltext. */
      test: Text,
      note: Text.optional(),
    })
    .strict(),
]);
export type Evidence = z.infer<typeof Evidence>;

export const Usage = z.object({ channel: Channel, text: Text }).strict();

export const Setting = z
  .object({
    name: Text,
    description: Text,
    /** Wo eingestellt wird, z. B. `PUT /v1/products/{sku}/units` oder eine Umgebungsvariable. */
    where: Text.optional(),
  })
  .strict();

export const Technical = z
  .object({
    /** Quellcode-Dateien oder -Verzeichnisse (relativ zum Repository; müssen existieren). */
    components: z.array(Text).min(1),
    endpoints: z.array(EndpointRef).default([]),
    events: z.object({ emits: z.array(Text).default([]), consumes: z.array(Text).default([]) }).strict().default({ emits: [], consumes: [] }),
    /** Routen der Oberfläche aus apps/web/src/App.tsx, z. B. `/bestand`. */
    uiRoutes: z.array(Text).default([]),
    /** Node-RED-Node-Typen aus packages/node-red-nodes, z. B. `wms-api`. */
    nodeRedNodes: z.array(Text).default([]),
    /** Datenbanktabellen, Fehlercodes und andere Hinweise für Entwickler. */
    notes: z.array(Text).default([]),
  })
  .strict();

/**
 * Einstufung gegenüber einem anderen System (z. B. OpenWMS), je System ein Eintrag:
 * gleichwertig, erweitert (kann mehr), eingeschraenkt (kann weniger), neu (dort nicht vorhanden),
 * abweichend (gleicher Zweck, anderer Ansatz), nicht-einsehbar (Gegenstück nur in nicht öffentlichen Teilen).
 */
export const COMPARISON_STATES = ['gleichwertig', 'erweitert', 'eingeschraenkt', 'neu', 'abweichend', 'nicht-einsehbar'] as const;
export const Comparison = z
  .object({
    status: z.enum(COMPARISON_STATES),
    note: Text.optional(),
    refs: z.array(Text).default([]),
  })
  .strict();

const FeatureBase = {
  id: Id,
  title: Text,
  group: Id,
  /** Nutzen in einem Satz. */
  summary: Text,
  /** Fachliche Beschreibung: was die Funktion leistet. */
  description: Text,
  usage: z.array(Usage).min(1),
  /** Fachliche Regeln und Grenzen. */
  rules: z.array(Text).default([]),
  /** Was sich einstellen lässt (Regeln, Strategien, Parameter). */
  settings: z.array(Setting).default([]),
  /** Features, ohne die dieses nicht nutzbar ist. */
  dependsOn: z.array(Id).default([]),
  technical: Technical,
  comparisons: z.record(z.string(), Comparison).default({}),
};

/** Eintrag im Katalog: nur nachweislich verfügbare Funktionen. */
export const Feature = z.object({ ...FeatureBase, evidence: z.array(Evidence).min(1, 'Ein Feature im Katalog braucht mindestens einen Nachweis') }).strict();
export type Feature = z.infer<typeof Feature>;

export const REVIEW_STATES = ['unvollstaendig', 'deaktiviert', 'nicht-nachgewiesen'] as const;

/** Eintrag im Prüfbestand: vorhanden, aber (noch) nicht als verfügbar belegt. */
export const ReviewItem = z
  .object({
    ...FeatureBase,
    usage: z.array(Usage).default([]),
    state: z.enum(REVIEW_STATES),
    /** Warum der Eintrag nicht im Katalog steht und was fehlt. */
    reason: Text,
    evidence: z.array(Evidence).default([]),
  })
  .strict();
export type ReviewItem = z.infer<typeof ReviewItem>;

/**
 * Zuständigkeit eines Bereichs für automatisch erkannte Bestandteile. Damit ordnet die Prüfung jeden
 * erkannten Endpunkt, jedes Ereignis, jede Route und jeden Node genau einem Bereich zu.
 */
export const Owns = z
  .object({
    /** Pfad-Präfixe (`/v1/stock` passt auf `/v1/stock` und `/v1/stock/…`, nicht auf `/v1/stock-counts`). */
    endpoints: z.array(Text).default([]),
    /** Ereignistyp-Präfixe bis zum Punkt (`stock` passt auf `stock.issued`). */
    events: z.array(Text).default([]),
    uiRoutes: z.array(Text).default([]),
    nodeRedNodes: z.array(Text).default([]),
  })
  .strict();

/** Vergleichssystem; `complete: true` verlangt eine Einstufung für jedes Feature. */
export const ComparisonSystem = z
  .object({ id: Id, title: Text, description: Text, source: Text.optional(), complete: z.boolean().default(false) })
  .strict();

export const GAP_STATES = ['fehlt', 'teilweise', 'bewusst-weggelassen'] as const;

/** Fähigkeit des Vergleichssystems, die bei uns fehlt oder nur teilweise vorhanden ist. */
export const Gap = z
  .object({
    id: Id,
    title: Text,
    /** Bereich, in den die Fähigkeit bei uns gehören würde. */
    area: Id,
    summary: Text,
    status: z.enum(GAP_STATES),
    /** `oss`: im öffentlichen Code belegt; `privat`: nur aus der Beschreibung des Projekts bekannt. */
    source: z.enum(['oss', 'privat']),
    note: Text.optional(),
    refs: z.array(Text).default([]),
    /** Features, die die Lücke teilweise abdecken oder ersetzen. */
    related: z.array(Id).default([]),
  })
  .strict();
export type Gap = z.infer<typeof Gap>;

export const GapFile = z.object({ system: Id, gaps: z.array(Gap).default([]) }).strict();

export const Group = z.object({ id: Id, title: Text, summary: Text }).strict();

export const Area = z
  .object({
    id: Id,
    title: Text,
    summary: Text,
    /**
     * `katalogisiert`: Bestandsaufnahme abgeschlossen – nicht zugeordnete Bestandteile sind ein Fehler.
     * `offen`: noch nicht katalogisiert – nicht zugeordnete Bestandteile werden nur gezählt.
     */
    status: z.enum(['katalogisiert', 'offen']),
    owns: Owns,
    groups: z.array(Group).default([]),
  })
  .strict();
export type Area = z.infer<typeof Area>;

/** Technische Bestandteile, die bewusst kein Feature sind (z. B. Healthcheck), mit Begründung. */
export const Exclusion = z.object({ ref: Text, reason: Text }).strict();

export const Taxonomy = z
  .object({
    schemaVersion: z.literal(1),
    areas: z.array(Area).min(1),
    systems: z.array(ComparisonSystem).default([]),
    exclusions: z
      .object({
        endpoints: z.array(Exclusion).default([]),
        events: z.array(Exclusion).default([]),
        uiRoutes: z.array(Exclusion).default([]),
        nodeRedNodes: z.array(Exclusion).default([]),
      })
      .strict()
      .default({ endpoints: [], events: [], uiRoutes: [], nodeRedNodes: [] }),
  })
  .strict();
export type Taxonomy = z.infer<typeof Taxonomy>;

export const FeatureFile = z.object({ area: Id, features: z.array(Feature) }).strict();
export const ReviewFile = z.object({ items: z.array(ReviewItem).default([]) }).strict();
