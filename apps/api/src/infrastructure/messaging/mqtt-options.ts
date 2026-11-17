import { readFileSync } from 'node:fs';
import type { IClientOptions } from 'mqtt';
import type { AppConfig } from '../../config.js';

/**
 * Gemeinsame Verbindungsoptionen: Anmeldung (Benutzer/Passwort) und bei
 * mqtts:// die eigene Zertifizierungsstelle. Das Serverzertifikat wird immer
 * geprüft (rejectUnauthorized).
 */
export function mqttOptions(config: AppConfig, clientSuffix: string): IClientOptions {
  return {
    clientId: `${config.serviceName}-${clientSuffix}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    clean: true,
    ...(config.mqtt.username ? { username: config.mqtt.username } : {}),
    ...(config.mqtt.password ? { password: config.mqtt.password } : {}),
    ...(config.mqtt.caFile ? { ca: readFileSync(config.mqtt.caFile), rejectUnauthorized: true } : {}),
  };
}
