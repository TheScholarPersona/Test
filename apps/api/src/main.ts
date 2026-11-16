import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { ConfigError, loadConfig } from './config.js';
import { runMigrations } from './infrastructure/database/migrate.js';

const logger = new Logger('Bootstrap');

try {
  const config = loadConfig(process.env);
  if (config.dbMigrateOnStart) {
    const executed = await runMigrations(config);
    logger.log(executed.length > 0 ? `Migrationen ausgeführt: ${executed.join(', ')}` : 'Datenbankschema ist aktuell');
  }
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  logger.log(`WMS-API läuft auf http://${config.host}:${config.port} (Profil: ${config.profile})`);
} catch (error: unknown) {
  logger.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
