import { MikroORM } from '@mikro-orm/postgresql';
import type { AppConfig } from '../../config.js';
import { createOrmOptions } from './orm-options.js';

/** Führt alle offenen Migrationen aus; Rückgabe: Namen der ausgeführten Migrationen. */
export async function runMigrations(config: Pick<AppConfig, 'databaseUrl' | 'profile'>): Promise<string[]> {
  const orm = await MikroORM.init(createOrmOptions(config));
  try {
    const executed = await orm.migrator.up();
    return executed.map((migration) => migration.name);
  } finally {
    await orm.close(true);
  }
}

/** Erzeugt eine neue Migration aus dem Unterschied zwischen Entities und Datenbank. */
export async function createMigration(config: Pick<AppConfig, 'databaseUrl' | 'profile'>, initial: boolean): Promise<string | undefined> {
  const orm = await MikroORM.init(createOrmOptions(config));
  try {
    const result = await orm.migrator.create('src/migrations', false, initial);
    return result.diff.up.length > 0 ? result.fileName : undefined;
  } finally {
    await orm.close(true);
  }
}
