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
import { Migration20261117300000_stock } from './Migration20261117300000_stock.js';
import { Migration20261117400000_outbound } from './Migration20261117400000_outbound.js';
import { Migration20261117500000_auth } from './Migration20261117500000_auth.js';
import { Migration20261117600000_unit_errors_plc_state } from './Migration20261117600000_unit_errors_plc_state.js';
import { Migration20261117700000_movement_groups } from './Migration20261117700000_movement_groups.js';
import { Migration20261117800000_partners } from './Migration20261117800000_partners.js';
import { Migration20261117900000_shipping } from './Migration20261117900000_shipping.js';
import { Migration20261118000000_receiving_priority_lock } from './Migration20261118000000_receiving_priority_lock.js';
import { Migration20261118100000_erp_messages } from './Migration20261118100000_erp_messages.js';
import { Migration20261118200000_transport_order_problems } from './Migration20261118200000_transport_order_problems.js';
import { Migration20261121100000_journal_chain } from './Migration20261121100000_journal_chain.js';

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
  { name: Migration20261117300000_stock.name, class: Migration20261117300000_stock },
  { name: Migration20261117400000_outbound.name, class: Migration20261117400000_outbound },
  { name: Migration20261117500000_auth.name, class: Migration20261117500000_auth },
  { name: Migration20261117600000_unit_errors_plc_state.name, class: Migration20261117600000_unit_errors_plc_state },
  { name: Migration20261117700000_movement_groups.name, class: Migration20261117700000_movement_groups },
  { name: Migration20261117800000_partners.name, class: Migration20261117800000_partners },
  { name: Migration20261117900000_shipping.name, class: Migration20261117900000_shipping },
  { name: Migration20261118000000_receiving_priority_lock.name, class: Migration20261118000000_receiving_priority_lock },
  { name: Migration20261118100000_erp_messages.name, class: Migration20261118100000_erp_messages },
  { name: Migration20261118200000_transport_order_problems.name, class: Migration20261118200000_transport_order_problems },
  { name: Migration20261121100000_journal_chain.name, class: Migration20261121100000_journal_chain },
];
