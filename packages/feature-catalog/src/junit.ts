/**
 * Liest JUnit-Berichte (Vitest, Playwright) und ordnet Nachweise ihren Ergebnissen zu.
 * Damit zeigt der Katalog nicht nur, dass ein Test existiert, sondern dass er im letzten Lauf bestanden hat.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Evidence } from './schema.ts';

export type TestResult = 'bestanden' | 'fehlgeschlagen' | 'uebersprungen';

export interface ReportedTest {
  report: string;
  name: string;
  classname: string;
  file: string;
  result: TestResult;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function attribute(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : '';
}

export function parseJunit(xml: string, report = 'junit'): ReportedTest[] {
  const out: ReportedTest[] = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const tag = m[1]!;
    const body = m[3] ?? '';
    const result: TestResult = /<(failure|error)\b/.test(body) ? 'fehlgeschlagen' : /<skipped\b/.test(body) ? 'uebersprungen' : 'bestanden';
    out.push({ report, name: attribute(tag, 'name'), classname: attribute(tag, 'classname'), file: attribute(tag, 'file'), result });
  }
  return out;
}

/** Alle `*junit*.xml` eines Verzeichnisses. */
export function readReports(dir: string): ReportedTest[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /junit.*\.xml$/.test(f))
    .sort()
    .flatMap((f) => parseJunit(readFileSync(join(dir, f), 'utf8'), f));
}

/** Welche Berichtsart deckt welche Nachweisart ab (erkannt am Inhalt, nicht am Dateinamen). */
export function coveredKinds(tests: ReportedTest[]): Set<Evidence['kind']> {
  const kinds = new Set<Evidence['kind']>();
  for (const t of tests) {
    const where = `${t.classname} ${t.file}`;
    if (/ – /.test(t.name) && /scenario|Szenario|scenarios\.test/.test(`${where} ${t.report}`)) kinds.add('scenario');
    if (/test\/integration\//.test(where)) kinds.add('integration');
    if (/test\/unit\//.test(where)) kinds.add('unit');
    if (/\.spec\.ts/.test(where)) kinds.add('web-e2e');
  }
  return kinds;
}

/** Ergebnis eines Nachweises; `undefined`, wenn er in den Berichten nicht vorkommt. */
export function resultOf(evidence: Evidence, tests: ReportedTest[]): TestResult | undefined {
  const matches = tests.filter((t) => {
    if (evidence.kind === 'scenario') return t.name.startsWith(`${evidence.id} – `) || t.name.includes(` > ${evidence.id} – `);
    const file = basename(evidence.file);
    const where = `${t.classname} ${t.file}`;
    return (t.name === evidence.test || t.name.endsWith(` > ${evidence.test}`) || t.name.endsWith(` › ${evidence.test}`)) && where.includes(file);
  });
  if (matches.length === 0) return undefined;
  if (matches.some((t) => t.result === 'fehlgeschlagen')) return 'fehlgeschlagen';
  if (matches.every((t) => t.result === 'uebersprungen')) return 'uebersprungen';
  return 'bestanden';
}
