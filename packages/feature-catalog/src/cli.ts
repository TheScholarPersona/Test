/**
 * Feature-Katalog auf der Kommandozeile.
 *
 *   node src/cli.ts check [--reports <dir>]              Katalog gegen den Code prüfen (Exit-Code 1 bei Fehlern)
 *   node src/cli.ts build [--reports <dir>] [--out <dir>] Ansicht erzeugen (catalog/dist/index.html und catalog.json)
 *
 * Mit `--reports` werden JUnit-Berichte (reports/*junit*.xml) einbezogen: Nachweise gelten dann erst
 * als erbracht, wenn der Test im Lauf bestanden hat.
 */
import { join, resolve } from 'node:path';
import { analyze, type Finding } from './analyze.ts';
import { buildView } from './build.ts';
import { discover, REPO_ROOT } from './discover.ts';
import { readReports } from './junit.ts';
import { CatalogLoadError, loadCatalog } from './load.ts';

const [command = 'check', ...args] = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ICON: Record<Finding['level'], string> = { fehler: '✗', warnung: '!', hinweis: '·' };

function main(): number {
  const catalogDir = join(REPO_ROOT, 'catalog');
  let data;
  try {
    data = loadCatalog(catalogDir);
  } catch (error) {
    if (error instanceof CatalogLoadError) {
      console.error(`✗ ${error.message}`);
      return 1;
    }
    throw error;
  }
  const reportDir = option('--reports');
  const reports = reportDir ? readReports(resolve(reportDir)) : undefined;
  const analysis = analyze(data, discover(), reports);

  if (command === 'build') {
    const out = resolve(option('--out') ?? join(catalogDir, 'dist'));
    buildView(analysis, data, out);
    console.log(`Katalogansicht geschrieben: ${join(out, 'index.html')}`);
  } else if (command !== 'check') {
    console.error(`Unbekannter Befehl „${command}“ (check | build)`);
    return 2;
  }

  for (const level of ['hinweis', 'warnung', 'fehler'] as const) {
    for (const f of analysis.findings.filter((x) => x.level === level)) console.log(`${ICON[level]} ${f.code} ${f.subject} – ${f.message}`);
  }
  const count = (level: Finding['level']) => analysis.findings.filter((f) => f.level === level).length;
  const proven = analysis.features.filter((f) => f.proof === 'nachgewiesen').length;
  const partial = analysis.features.filter((f) => f.proof === 'teilweise').length;
  const criteria = analysis.features.flatMap((f) => f.acceptance);
  const belegt = criteria.filter((c) => c.status === 'nachgewiesen').length;
  console.log(
    `\nKatalog: ${analysis.features.length} Features (${proven} im Testlauf nachgewiesen${partial ? `, ${partial} teilweise` : ''}${reports ? '' : ' – ohne Testberichte nur statisch geprüft'}), ` +
      `${criteria.length} Akzeptanzkriterien (${belegt} im Testlauf belegt), ` +
      `${analysis.review.length} im Prüfbestand. ${count('fehler')} Fehler, ${count('warnung')} Warnungen, ${count('hinweis')} Hinweise.`,
  );
  return count('fehler') > 0 ? 1 : 0;
}

process.exitCode = main();
