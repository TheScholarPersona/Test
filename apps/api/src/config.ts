import { z } from 'zod';

/**
 * Konfiguration aus Umgebungsvariablen, beim Start einmal geprüft.
 * Fehlerhafte Werte brechen den Start mit einer verständlichen Meldung ab.
 */

const booleanString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const EnvSchema = z.object({
  APP_PROFILE: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1).default('wms-api'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_MIGRATE_ON_START: booleanString(false),
  MQTT_URL: z.url({ protocol: /^mqtts?$/ }).default('mqtt://localhost:1883'),
  OUTBOX_RELAY_ENABLED: booleanString(true),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  /** Verzeichnis mit der gebauten Oberfläche (apps/web/dist); ohne Angabe liefert die API keine Oberfläche aus. */
  WEB_DIST_DIR: z.string().min(1).optional(),
  OUTBOX_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
});

export type AppProfile = z.infer<typeof EnvSchema>['APP_PROFILE'];

export interface AppConfig {
  profile: AppProfile;
  serviceName: string;
  host: string;
  port: number;
  databaseUrl: string;
  dbMigrateOnStart: boolean;
  mqttUrl: string;
  /** Gebaute Oberfläche, ausgeliefert unter /ui/. */
  webDistDir: string | null;
  outbox: {
    relayEnabled: boolean;
    pollIntervalMs: number;
    batchSize: number;
    publishTimeoutMs: number;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new ConfigError(`Ungültige Konfiguration:\n${details}`);
  }
  const e = result.data;
  return {
    profile: e.APP_PROFILE,
    serviceName: e.SERVICE_NAME,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dbMigrateOnStart: e.DB_MIGRATE_ON_START,
    mqttUrl: e.MQTT_URL,
    webDistDir: e.WEB_DIST_DIR ?? null,
    outbox: {
      relayEnabled: e.OUTBOX_RELAY_ENABLED,
      pollIntervalMs: e.OUTBOX_POLL_INTERVAL_MS,
      batchSize: e.OUTBOX_BATCH_SIZE,
      publishTimeoutMs: e.OUTBOX_PUBLISH_TIMEOUT_MS,
    },
  };
}

/** Injektions-Token für die Konfiguration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
