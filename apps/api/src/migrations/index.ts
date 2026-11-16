import type { MigrationObject } from '@mikro-orm/core';
import { Migration20261116000000_outbox } from './Migration20261116000000_outbox.js';
import { Migration20261116100000_layout } from './Migration20261116100000_layout.js';
import { Migration20261116200000_transport } from './Migration20261116200000_transport.js';
import { Migration20261116300000_strategy } from './Migration20261116300000_strategy.js';
import { Migration20261116400000_movement } from './Migration20261116400000_movement.js';
import { Migration20261116500000_inventory } from './Migration20261116500000_inventory.js';
import { Migration20261116600000_receiving } from './Migration20261116600000_receiving.js';
import { Migration20261117100000_transport_order } from './Migration20261117100000_transport_order.js';
import { Migration20261117200000_flow } from './Migration20261117200000_flow.js';

/**
 * Registrierte Migrationen in Ausführungsreihenfolge.
 * Neue Migration: `pnpm --filter @wms/api db:migration:create`, Datei prüfen,
 * dann hier eintragen.
 */
export const migrations: MigrationObject[] = [
  { name: Migration20261116000000_outbox.name, class: Migration20261116000000_outbox },
  { name: Migration20261116100000_layout.name, class: Migration20261116100000_layout },
  { name: Migration20261116200000_transport.name, class: Migration20261116200000_transport },
  { name: Migration20261116300000_strategy.name, class: Migration20261116300000_strategy },
  { name: Migration20261116400000_movement.name, class: Migration20261116400000_movement },
  { name: Migration20261116500000_inventory.name, class: Migration20261116500000_inventory },
  { name: Migration20261116600000_receiving.name, class: Migration20261116600000_receiving },
  { name: Migration20261117100000_transport_order.name, class: Migration20261117100000_transport_order },
  { name: Migration20261117200000_flow.name, class: Migration20261117200000_flow },
];
