/**
 * Inhalt eines Nachweises statisch beurteilen: Ein bestandener Test ist erst dann ein Funktionsnachweis,
 * wenn er die Fähigkeit auslöst und einen erwarteten Effekt oder eine Regel zusichert.
 *
 * Heuristik (ergänzt das Review, ersetzt es nicht):
 * - Körper des Tests ermitteln (`it('Titel', …)`/`test('Titel', …)` per Klammerzählung; Szenario: `registerScenario`-Block),
 *   dazu die in derselben Datei definierten Helfer, die der Körper aufruft.
 * - Zusicherungen zählen; reine Status-/Existenzprüfungen erkennen.
 * - Bezug zum Feature: Endpunkt-Pfad, Ereignistyp, Seite, Node-RED-Node oder importierte Komponente kommt vor.
 */
import { basename } from 'node:path';
import { pathPattern } from './discover.ts';

export interface EvidenceQuality {
  /** Körper gefunden? (sonst keine Aussage möglich) */
  found: boolean;
  assertions: number;
  /** Alle Zusicherungen prüfen nur Status, Existenz oder Wahrheitswert. */
  statusOnly: boolean;
  /** Berührt einen Bestandteil des Features. */
  related: boolean;
  /** Text, in dem gesucht wurde (Körper + verwendete Helfer). */
  text: string;
}

/** Ende eines Klammerblocks ab `open` (Index von `(`, `{` oder `[`), mit Strings, Template-Strings und Kommentaren. */
export function matchingClose(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let i = open;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '/' && next === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i += 2;
      continue;
    }
    // Regex-Literal (`toMatch(/"a":\{/)`): `/` nach einem Operator oder einer öffnenden Klammer.
    if (c === '/' && /[(,=:[!&|?{};]/.test(src.slice(open, i).trimEnd().at(-1) ?? '(')) {
      i++;
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== '/') && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '$' && src[i + 1] === '{') {
          const end = matchingClose(src, i + 1);
          if (end < 0) return -1;
          i = end + 1;
        } else i++;
      }
      i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Aufruf `it(`/`test(`/`it.each…(` mit diesem Titel: Text des gesamten Aufrufs. */
export function testBlock(src: string, title: string): string | undefined {
  for (const quote of ["'", '"', '`']) {
    const literal = `${quote}${title}${quote}`;
    let from = 0;
    for (;;) {
      const at = src.indexOf(literal, from);
      if (at < 0) break;
      from = at + 1;
      // Rückwärts bis zur öffnenden Klammer des Aufrufs (`it(`, `test(`, `test.skip(` …).
      const head = src.slice(Math.max(0, at - 40), at);
      const call = /\b(?:it|test)(?:\.\w+)*\(\s*$/.exec(head);
      if (!call) continue;
      const open = at - (head.length - call.index - call[0].lastIndexOf('('));
      const close = matchingClose(src, open);
      if (close > 0) return src.slice(open, close + 1);
    }
  }
  return undefined;
}

/** `registerScenario({ id: '<id>', … })`-Block eines Szenarios. */
export function scenarioBlock(src: string, id: string): string | undefined {
  const m = new RegExp(`registerScenario\\(\\{\\s*id:\\s*'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).exec(src);
  if (!m) return undefined;
  const open = src.indexOf('(', m.index);
  const close = matchingClose(src, open);
  return close > 0 ? src.slice(open, close + 1) : undefined;
}

/** In der Datei definierte Helfer (`const name = …`, `function name(…)`), die im Text aufgerufen werden – rekursiv eine Ebene tiefer. */
export function withHelpers(file: string, body: string): string {
  const defs = new Map<string, string>();
  for (const m of file.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const start = m.index + m[0].length;
    // Bis zum Ende der Anweisung: erstes `;` oder Zeilenende auf oberster Klammerebene.
    let i = start;
    let depth = 0;
    while (i < file.length) {
      const c = file[i]!;
      if ('({['.includes(c)) {
        const close = matchingClose(file, i);
        if (close < 0) break;
        i = close + 1;
        continue;
      }
      if (c === ';' || (c === '\n' && depth === 0 && !/^\s*[.?:|&+]/.test(file.slice(i + 1, i + 40)))) break;
      i++;
    }
    defs.set(m[1]!, file.slice(m.index, i));
  }
  for (const m of file.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const brace = file.indexOf('{', m.index);
    const close = brace > 0 ? matchingClose(file, brace) : -1;
    if (close > 0) defs.set(m[1]!, file.slice(m.index, close + 1));
  }
  let text = body;
  for (let round = 0; round < 2; round++) {
    const used = [...defs.entries()].filter(([name, def]) => !text.includes(def) && new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*[(.]`).test(text));
    if (!used.length) break;
    text += '\n' + used.map(([, def]) => def).join('\n');
  }
  return text;
}

const ASSERTION = /\bexpect(?:\.poll)?\s*\(|\bassert\w*\s*\(|\bassert\s|\bcheck\s*:|\bevent\s*:|\.toThrow|\brejects\.|\bexpectStatus\s*:/g;

/** Zusicherungen, die nur Status, Existenz oder Wahrheitswert prüfen. */
function isStatusOnly(text: string): boolean {
  const expects = [...text.matchAll(/\bexpect(?:\.poll)?\s*\(/g)].map((m) => {
    const open = text.indexOf('(', m.index);
    const close = matchingClose(text, open);
    const subject = close > 0 ? text.slice(open + 1, close) : '';
    const matcher = close > 0 ? (/^\s*(?:\.\s*not)?\s*\.\s*(\w+)\s*\(([^)]*)\)?/.exec(text.slice(close + 1, close + 200)) ?? []) : [];
    return { subject, matcher: matcher[1] ?? '', arg: matcher[2] ?? '' };
  });
  const other = /\bassert\w*\s*\(|\bcheck\s*:|\bevent\s*:/.test(text);
  if (other || expects.length === 0) return false;
  return expects.every(
    (e) =>
      /\.status(Code)?\s*$|\bstatus\(\)|\.ok\(\)\s*$/.test(e.subject.trim()) ||
      ['toBeTruthy', 'toBeDefined', 'toBeFalsy'].includes(e.matcher) ||
      (e.matcher === 'toBe' && /^\s*(true|false|undefined|null)\s*$/.test(e.arg)),
  );
}

export interface FeatureRefs {
  endpoints: { method: string; path: string }[];
  events: string[];
  uiRoutes: string[];
  nodeRedNodes: string[];
  components: string[];
}

/**
 * Wie `pathPattern`, aber feste Segmente hinter dem Ressourcennamen dürfen auch als Template-Ausdruck stehen
 * (Helfer wie `post(id, 'issues')` → `/v1/stock/${id}/${action}`).
 */
export function loosePathPattern(path: string): RegExp {
  const param = '(?:\\$\\{[^}]*\\}|[^/?#\'"`\\s])+';
  const segments = path.split('/');
  const source = segments
    .map((seg, i) => {
      if (seg.startsWith('{')) return param;
      const literal = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return i >= 3 ? `(?:${literal}|\\$\\{[^}]*\\})` : literal;
    })
    .join('/');
  return new RegExp(`${source}(?=[?#'"\`/]|$)`, 'm');
}

/** Berührt der Text einen Bestandteil des Features? `fileText` dient für Importe (Unit-Tests). */
function isRelated(text: string, fileText: string, refs: FeatureRefs): boolean {
  for (const e of refs.endpoints) if (pathPattern(e.path).test(text) || loosePathPattern(e.path).test(text)) return true;
  for (const e of refs.events) if (text.includes(`'${e}'`) || text.includes(`"${e}"`) || text.includes(e.replace('.', '/'))) return true;
  for (const r of refs.uiRoutes) {
    const route = r.replace(/\/\*$/, '');
    if (route === '/' && /\bgoto\(\s*['"`]\.?\/['"`]/.test(text)) return true;
    if (route !== '/' && new RegExp(`['"\`](?:\\.|/ui)?${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/'"\`?])`).test(text)) return true;
  }
  for (const n of refs.nodeRedNodes) if (text.includes(`'${n}'`) || text.includes(`"${n}"`)) return true;
  for (const c of refs.components) {
    const name = basename(c).replace(/\.(ts|tsx|js|mjs)$/, '');
    if (name && new RegExp(`from\\s+['"][^'"]*/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.js|\\.ts|\\.mjs)?['"]|require\\(['"][^'"]*/${name}(\\.js)?['"]\\)`).test(fileText)) return true;
  }
  return false;
}

/** Inhalt eines Nachweises beurteilen. */
export function assess(fileText: string, block: string | undefined, refs: FeatureRefs): EvidenceQuality {
  if (!block) return { found: false, assertions: 0, statusOnly: false, related: false, text: '' };
  const text = withHelpers(fileText, block);
  const assertions = [...block.matchAll(ASSERTION)].length + [...text.slice(block.length).matchAll(ASSERTION)].length;
  return { found: true, assertions, statusOnly: assertions > 0 && isStatusOnly(text), related: isRelated(text, fileText, refs), text };
}

/** Fehlercodes in Regeltexten: `CODE` in Backticks, mindestens zwei Teile mit Unterstrich oder bekannte Großschreibung. */
export function codesIn(rules: string[]): string[] {
  const codes = new Set<string>();
  for (const r of rules) {
    // Zustandsketten (`OPEN` → `IN_PROGRESS` → `DONE`) nennen Zustände, keine Codes, die ein Test auslösen muss.
    const states = new Set<string>();
    for (const m of r.matchAll(/`([A-Z0-9_]+)`\s*→\s*(?=`([A-Z0-9_]+)`)/g)) states.add(m[1]!).add(m[2]!);
    for (const m of r.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) if (!states.has(m[1]!)) codes.add(m[1]!);
  }
  return [...codes];
}
