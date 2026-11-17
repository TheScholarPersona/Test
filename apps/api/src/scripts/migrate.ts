import 'reflect-metadata';
import { loadConfig } from '../config.js';
import { databaseOptions } from '../database.js';
import { createMigration, runMigrations } from '../infrastructure/database/migrate.js';

/**
 * Kommandozeile für Migrationen (nach `pnpm build` im Verzeichnis apps/api):
 *   node dist/scripts/migrate.js up       – offene Migrationen ausführen
 *   node dist/scripts/migrate.js create   – neue Migration in src/migrations erzeugen
 *   node dist/scripts/migrate.js initial  – erste Migration erzeugen (leere Datenbank)
 */
const command = process.argv[2];
const config = loadConfig(process.env);

switch (command) {
  case 'up': {
    const executed = await runMigrations(databaseOptions(config));
    console.log(executed.length > 0 ? `Ausgeführt: ${executed.join(', ')}` : 'Keine offenen Migrationen');
    break;
  }
  case 'create':
  case 'initial': {
    const file = await createMigration(databaseOptions(config), command === 'initial');
    console.log(file ? `Erzeugt: src/migrations/${file} – bitte prüfen und in src/migrations/index.ts eintragen` : 'Keine Schemaänderungen gefunden');
    break;
  }
  default:
    console.error('Verwendung: migrate.js up | create | initial');
    process.exitCode = 1;
}
