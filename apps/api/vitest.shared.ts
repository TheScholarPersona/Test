import { fileURLToPath } from 'node:url';
import type { ViteUserConfig } from 'vitest/config';

/**
 * Gemeinsame Vitest-Einstellungen für Unit- und Integrationstests.
 *
 * - NestJS braucht Decorator-Metadaten (`design:paramtypes`) für Dependency
 *   Injection; der oxc-Transformer von Vite erzeugt sie mit `legacy` + `emitDecoratorMetadata`.
 * - `@wms/shared` wird direkt aus dem Quelltext geladen, damit Tests kein
 *   vorheriges Bauen des Pakets brauchen.
 */
export const sharedConfig: ViteUserConfig = {
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  resolve: {
    alias: {
      '@wms/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
};
