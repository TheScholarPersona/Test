import type { AppConfig } from './config.js';
import { createOrmOptions } from './infrastructure/database/orm-options.js';
import { OutboxMessage } from './infrastructure/outbox/outbox-message.entity.js';
import { layoutEntities } from './modules/layout/index.js';
import { transportEntities } from './modules/transport/index.js';

/** Alle Entities der Anwendung; neue Fachmodule tragen ihre hier ein. */
export const allEntities = [OutboxMessage, ...layoutEntities, ...transportEntities];

export function databaseOptions(config: Pick<AppConfig, 'databaseUrl'>) {
  return createOrmOptions(config, allEntities);
}
