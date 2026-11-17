import type { AppConfig } from './config.js';
import { createOrmOptions } from './infrastructure/database/orm-options.js';
import { OutboxMessage } from './infrastructure/outbox/outbox-message.entity.js';
import { inventoryEntities } from './modules/inventory/index.js';
import { layoutEntities } from './modules/layout/index.js';
import { movementEntities } from './modules/movement/index.js';
import { receivingEntities } from './modules/receiving/index.js';
import { flowEntities } from './modules/flow/index.js';
import { outboundEntities } from './modules/outbound/index.js';
import { transportOrderEntities } from './modules/transport-order/index.js';
import { strategyEntities } from './modules/strategy/index.js';
import { transportEntities } from './modules/transport/index.js';

/** Alle Entities der Anwendung; neue Fachmodule tragen ihre hier ein. */
export const allEntities = [OutboxMessage, ...layoutEntities, ...transportEntities, ...strategyEntities, ...movementEntities, ...inventoryEntities, ...receivingEntities, ...transportOrderEntities, ...flowEntities, ...outboundEntities];

export function databaseOptions(config: Pick<AppConfig, 'databaseUrl'>) {
  return createOrmOptions(config, allEntities);
}
