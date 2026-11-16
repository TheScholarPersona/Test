import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import type { AppConfig } from '../../config.js';
import { migrations } from '../../migrations/index.js';
import { OutboxMessage } from '../outbox/outbox-message.entity.js';

/** Alle Entities der Anwendung; neue Fachmodule tragen ihre hier ein. */
export const entities = [OutboxMessage];

export function createOrmOptions(config: Pick<AppConfig, 'databaseUrl' | 'profile'>) {
  return defineConfig({
    driver: PostgreSqlDriver,
    clientUrl: config.databaseUrl,
    entities,
    extensions: [Migrator],
    migrations: {
      // Explizite Liste statt Dateisuche: funktioniert gleich im Build und in Tests.
      migrationsList: migrations,
      pathTs: 'src/migrations',
      path: 'dist/migrations',
      transactional: true,
      allOrNothing: true,
      emit: 'ts',
    },
    // Schema wird ausschließlich über Migrationen verändert.
    ensureDatabase: false,
    debug: false,
  });
}
