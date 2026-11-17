/**
 * Automatische Bestandsaufnahme aus dem Code: Endpunkte, Ereignisse, Oberflächen-Routen,
 * Node-RED-Nodes, Szenarien und Testdateien. Nur lesend; die Applikation bleibt unverändert.
 *
 * Quellen:
 * - Endpunkte: apps/web/src/api/openapi.json (ein Integrationstest hält die Datei deckungsgleich mit der API)
 * - Ereignisse: `defineEvent('<typ>', …)` in packages/shared/src
 * - Routen: `<Route path="…">` in apps/web/src/App.tsx
 * - Node-RED-Nodes: `node-red.nodes` in packages/node-red-nodes/package.json
 * - Szenarien: `registerScenario({ id: … })` in flows/scenarios und Szenario-Tabs (`scenario:<id>`) im Flow-Generator
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface DiscoveredEndpoint {
  ref: string;
  method: string;
  path: string;
  summary: string;
  tags: string[];
}

export interface SourceFile {
  path: string;
  text: string;
}

export interface Discovery {
  root: string;
  endpoints: Map<string, DiscoveredEndpoint>;
  events: Set<string>;
  uiRoutes: Set<string>;
  nodeRedNodes: Set<string>;
  scenarios: Set<string>;
  /** Test- und Szenario-Dateien (für Nachweise). */
  testFiles: SourceFile[];
  /** Dateien, die die laufende API aufrufen: Integrationstests, Browser-Tests, Szenarien (für `filesCalling`). */
  callingFiles: SourceFile[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function walk(root: string, dir: string, accept: (file: string) => boolean): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute).sort()) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) out.push(...walk(root, relative(root, full), accept));
    else if (accept(entry)) out.push(relative(root, full));
  }
  return out;
}

export function discover(root = REPO_ROOT): Discovery {
  const openapi = JSON.parse(read(root, 'apps/web/src/api/openapi.json')) as {
    paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
  };
  const endpoints = new Map<string, DiscoveredEndpoint>();
  for (const [path, operations] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!METHODS.includes(method)) continue;
      const ref = `${method.toUpperCase()} ${path}`;
      endpoints.set(ref, { ref, method: method.toUpperCase(), path, summary: operation.summary ?? '', tags: operation.tags ?? [] });
    }
  }

  const events = new Set<string>();
  for (const file of walk(root, 'packages/shared/src', (f) => f.endsWith('.ts'))) {
    for (const m of read(root, file).matchAll(/defineEvent\(\s*'([^']+)'/g)) events.add(m[1]!);
  }

  const uiRoutes = new Set<string>();
  for (const m of read(root, 'apps/web/src/App.tsx').matchAll(/<Route\s+path="([^"]+)"/g)) {
    if (m[1] !== '*') uiRoutes.add(m[1]!);
  }

  const nodePackage = JSON.parse(read(root, 'packages/node-red-nodes/package.json')) as { 'node-red': { nodes: Record<string, string> } };
  const nodeRedNodes = new Set(Object.keys(nodePackage['node-red'].nodes));

  const scenarios = new Set<string>();
  for (const file of walk(root, 'flows/scenarios', (f) => f.endsWith('.js'))) {
    for (const m of read(root, file).matchAll(/registerScenario\(\{\s*id:\s*'([^']+)'/g)) scenarios.add(m[1]!);
  }
  for (const m of read(root, 'flows/scripts/build-flows.mjs').matchAll(/name:\s*'scenario:([^']+)'/g)) scenarios.add(m[1]!);

  const isTest = (f: string) => /\.(test|spec)\.(ts|mjs|js)$/.test(f) || f.endsWith('.ts');
  const testFiles = [
    ...walk(root, 'apps/api/test', isTest),
    ...walk(root, 'apps/web/e2e', isTest),
    ...walk(root, 'flows/scenarios', (f) => f.endsWith('.js')),
    ...readdirSync(join(root, 'packages')).flatMap((p) => walk(root, `packages/${p}/test`, isTest)),
  ].map((path) => ({ path, text: read(root, path) }));

  const calling = /^(apps\/api\/test\/integration|apps\/web\/e2e|flows\/scenarios)\//;
  const callingFiles = testFiles.filter((f) => calling.test(f.path));

  return { root, endpoints, events, uiRoutes, nodeRedNodes, scenarios, testFiles, callingFiles };
}

/** Regulärer Ausdruck für die Verwendung eines Endpunkt-Pfads im Quelltext (`{id}` → beliebiges Segment). */
export function pathPattern(path: string): RegExp {
  const source = path
    .split(/(\{[^}]+\})/)
    // Parameter: Template-Ausdruck (`${mv['P1']}`) oder ein Segment ohne Trennzeichen.
    .map((part) => (part.startsWith('{') ? '(?:\\$\\{[^}]*\\}|[^/?#\'"`\\s])+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  // Danach endet der Pfad: Anführungszeichen, Query-String oder Ende eines Template-Literals.
  return new RegExp(`${source}(?=[?#'"\`]|$)`, 'gm');
}

/**
 * Dateien, in denen der Endpunkt aufgerufen wird (Heuristik): Pfad passt, und die zuletzt davor
 * genannte HTTP-Methode passt. Pfade ohne Methode davor (z. B. Listen erwarteter OpenAPI-Pfade) zählen nicht.
 */
export function filesCalling(endpoint: { method: string; path: string }, files: SourceFile[]): string[] {
  const pattern = pathPattern(endpoint.path);
  const hits: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(pattern)) {
      const before = file.text.slice(Math.max(0, match.index - 80), match.index);
      const methods = [...before.matchAll(/\b(get|post|put|patch|delete|fetch)\b/gi)];
      // `fetch(url)` ohne Methode ist ein GET.
      const method = methods.at(-1)?.[1]?.toUpperCase().replace('FETCH', 'GET');
      if (method === endpoint.method) {
        hits.push(file.path);
        break;
      }
    }
  }
  return hits;
}

/** Enthält die Datei den Titel als String-Literal (so wie in `it('…')` oder `test('…')`)? */
export function containsTitle(text: string, title: string): boolean {
  return [`'${title}'`, `"${title}"`, `\`${title}\``].some((literal) => text.includes(literal));
}
