/**
 * Architekturregeln, geprüft mit `pnpm lint:deps`.
 *
 * Fachmodule (apps/api/src/modules/<modul>) sprechen miteinander nur über
 * ihre öffentliche Schnittstelle `index.ts`. So bleiben die Grenzen des
 * modularen Monolithen erhalten und Module lassen sich später herauslösen.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Zyklische Abhängigkeiten machen Module untrennbar.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'module-only-via-index',
      severity: 'error',
      comment: 'Ein Fachmodul darf ein anderes nur über dessen index.ts verwenden.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'app-uses-module-index',
      severity: 'error',
      comment: 'Der App-Rahmen bindet Fachmodule nur über index.ts ein.',
      from: { path: '^apps/api/src/[^/]+\\.ts$' },
      to: { path: '^apps/api/src/modules/[^/]+/', pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$' },
    },
    {
      name: 'infrastructure-not-to-modules',
      severity: 'error',
      comment: 'Infrastruktur (Datenbank, Outbox, MQTT, HTTP) kennt keine Fachmodule.',
      from: { path: '^apps/api/src/(infrastructure|http)/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'shared-is-standalone',
      severity: 'error',
      comment: 'Der gemeinsame Kern hängt nicht von Anwendungen ab.',
      from: { path: '^packages/shared/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-test-code-in-production',
      severity: 'error',
      from: { path: '/src/' },
      to: { path: '/test/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'apps/api/tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
