import type { MigrationObject } from '@mikro-orm/core';
import { Migration20261116000000_outbox } from './Migration20261116000000_outbox.js';
import { Migration20261116100000_layout } from './Migration20261116100000_layout.js';
import { Migration20261116200000_transport } from './Migration20261116200000_transport.js';

/**
 * Registrierte Migrationen in Ausführungsreihenfolge.
 * Neue Migration: `pnpm --filter @wms/api db:migration:create`, Datei prüfen,
 * dann hier eintragen.
 */
export const migrations: MigrationObject[] = [
  { name: Migration20261116000000_outbox.name, class: Migration20261116000000_outbox },
  { name: Migration20261116100000_layout.name, class: Migration20261116100000_layout },
  { name: Migration20261116200000_transport.name, class: Migration20261116200000_transport },
];
