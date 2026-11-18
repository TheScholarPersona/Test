import { createHash } from 'node:crypto';
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
  /** Passwort für den Benutzer `admin`, der beim Start angelegt wird, falls es ihn noch nicht gibt. */
  AUTH_ADMIN_PASSWORD: z.string().min(10, 'AUTH_ADMIN_PASSWORD braucht mindestens 10 Zeichen').optional(),
  /** Service-Tokens für Maschinen: `name:rolle+rolle:geheimnis;…` (Geheimnis mindestens 32 Zeichen). */
  AUTH_SERVICE_TOKENS: z.string().optional(),
  AUTH_SESSION_HOURS: z.coerce.number().min(0.1).max(24 * 30).default(12),
  /** Cookie nur über HTTPS senden: auto = wenn die Anfrage per HTTPS kam (auch hinter einem Proxy mit X-Forwarded-Proto). */
  AUTH_COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  /** Optionale MQTT-Anmeldung und TLS (mqtts://): Benutzer, Passwort, CA-Datei. */
  MQTT_USERNAME: z.string().min(1).optional(),
  MQTT_PASSWORD: z.string().min(1).optional(),
  MQTT_CA_FILE: z.string().min(1).optional(),
  OUTBOX_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  /** Veröffentlichte Outbox-Einträge so lange aufbewahren (Stunden), danach löschen. 0 = nie löschen. */
  OUTBOX_RETENTION_HOURS: z.coerce.number().min(0).max(24 * 3650).default(168),
  OUTBOX_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(1000).max(86_400_000).default(3_600_000),
  /** Rückmeldungen ans ERP erzeugen (Wareneingang, Warenausgang, Bestandsänderungen). Aus: es entstehen keine Ausgangsnachrichten. */
  ERP_EXPORT_ENABLED: booleanString(false),
  /** Zustellversuche je Ausgangsnachricht, danach FAILED (im Leitstand erneut anstoßbar). */
  ERP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
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
  mqtt: { username: string | null; password: string | null; caFile: string | null };
  auth: {
    adminPassword: string | null;
    serviceTokens: ServiceTokenConfig[];
    sessionHours: number;
    cookieSecure: 'auto' | 'true' | 'false';
  };
  outbox: {
    relayEnabled: boolean;
    pollIntervalMs: number;
    batchSize: number;
    publishTimeoutMs: number;
    /** 0 = veröffentlichte Einträge nie löschen. */
    retentionHours: number;
    cleanupIntervalMs: number;
  };
  erp: { exportEnabled: boolean; maxAttempts: number };
}

export interface ServiceTokenConfig {
  name: string;
  roles: string[];
  /** SHA-256 des Geheimnisses; das Geheimnis selbst wird nicht gehalten. */
  hash: Buffer;
}

const SERVICE_ROLES = ['admin', 'leitstand', 'lager', 'anlage', 'lesen'];

/** `name:rolle+rolle:geheimnis;…` → Tokens; Fehler mit verständlicher Meldung (ohne das Geheimnis). */
export function parseServiceTokens(value: string | undefined): ServiceTokenConfig[] {
  if (!value?.trim()) return [];
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [name, roleList, ...secretParts] = entry.split(':');
      const secret = secretParts.join(':');
      const roles = (roleList ?? '').split('+').filter(Boolean);
      if (!name || !/^[a-z0-9-]{1,40}$/.test(name)) throw new ConfigError(`AUTH_SERVICE_TOKENS Eintrag ${index + 1}: Name fehlt oder ist ungültig (a-z, 0-9, -)`);
      if (roles.length === 0 || roles.some((r) => !SERVICE_ROLES.includes(r))) {
        throw new ConfigError(`AUTH_SERVICE_TOKENS ${name}: Rollen ungültig (erlaubt: ${SERVICE_ROLES.join(', ')})`);
      }
      if (secret.length < 32) throw new ConfigError(`AUTH_SERVICE_TOKENS ${name}: Geheimnis braucht mindestens 32 Zeichen`);
      return { name, roles, hash: createHash('sha256').update(secret).digest() };
    });
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
    mqtt: { username: e.MQTT_USERNAME ?? null, password: e.MQTT_PASSWORD ?? null, caFile: e.MQTT_CA_FILE ?? null },
    auth: {
      adminPassword: e.AUTH_ADMIN_PASSWORD ?? null,
      serviceTokens: parseServiceTokens(e.AUTH_SERVICE_TOKENS),
      sessionHours: e.AUTH_SESSION_HOURS,
      cookieSecure: e.AUTH_COOKIE_SECURE,
    },
    outbox: {
      relayEnabled: e.OUTBOX_RELAY_ENABLED,
      pollIntervalMs: e.OUTBOX_POLL_INTERVAL_MS,
      batchSize: e.OUTBOX_BATCH_SIZE,
      publishTimeoutMs: e.OUTBOX_PUBLISH_TIMEOUT_MS,
      retentionHours: e.OUTBOX_RETENTION_HOURS,
      cleanupIntervalMs: e.OUTBOX_CLEANUP_INTERVAL_MS,
    },
    erp: { exportEnabled: e.ERP_EXPORT_ENABLED, maxAttempts: e.ERP_MAX_ATTEMPTS },
  };
}

/** Injektions-Token für die Konfiguration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
