import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, type Options, PostgreSqlDriver } from '@mikro-orm/postgresql';
import type { AppConfig } from '../../config.js';
import { migrations } from '../../migrations/index.js';

export type OrmEntities = NonNullable<Options['entities']>;
export type OrmOptions = ReturnType<typeof createOrmOptions>;

/**
 * ORM-Konfiguration. Die Entities kommen von außen (src/database.ts),
 * damit die Infrastruktur keine Fachmodule kennen muss.
 */
export function createOrmOptions(config: Pick<AppConfig, 'databaseUrl'>, entities: OrmEntities) {
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
