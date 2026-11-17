import { MikroORM } from '@mikro-orm/postgresql';
import type { OrmOptions } from './orm-options.js';

/** Führt alle offenen Migrationen aus; Rückgabe: Namen der ausgeführten Migrationen. */
export async function runMigrations(options: OrmOptions): Promise<string[]> {
  const orm = await MikroORM.init(options);
  try {
    const executed = await orm.migrator.up();
    return executed.map((migration) => migration.name);
  } finally {
    await orm.close(true);
  }
}

/** Erzeugt eine neue Migration aus dem Unterschied zwischen Entities und Datenbank. */
export async function createMigration(options: OrmOptions, initial: boolean): Promise<string | undefined> {
  const orm = await MikroORM.init(options);
  try {
    const result = await orm.migrator.create('src/migrations', false, initial);
    return result.diff.up.length > 0 ? result.fileName : undefined;
  } finally {
    await orm.close(true);
  }
}
