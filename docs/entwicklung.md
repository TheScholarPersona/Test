# Entwicklung

## Aufbau

```
apps/api/                  WMS-Kern (NestJS)
  src/config.ts            Konfiguration aus Umgebungsvariablen (Zod-geprüft)
  src/app.module.ts        bindet Infrastruktur und Fachmodule ein
  src/http/                Validierung (ZodValidationPipe), OpenAPI-Dokumentation
  src/infrastructure/
    database/              MikroORM-Konfiguration, Migrationen ausführen
    messaging/             MQTT-Anbindung (EventPublisher)
    outbox/                Transactional Outbox und Relay
  src/migrations/          versionierte Datenbankmigrationen (explizite Liste in index.ts)
  src/modules/<modul>/     Fachmodule; öffentliche Schnittstelle nur über index.ts
    health/                GET /health
    test-support/          Test-Endpunkte, nur im Profil "test"
  test/unit/               Unit-Tests (ohne Datenbank)
  test/integration/        Integrationstests mit Testcontainers
packages/shared/           gemeinsamer Kern: Kennungen, Quantity, Event-Format und -Katalog
packages/scenario-runner/  führt Node-RED-Szenarien aus, schreibt reports/e2e-junit.xml
flows/
  scripts/build-flows.mjs  erzeugt flows/node-red/flows.json
  node-red/flows.json      von Node-RED geladene Flows (generiert, versioniert)
docker/                    Konfiguration für Hilfsdienste (Mosquitto)
```

## Befehle

| Befehl | Zweck |
|---|---|
| `pnpm verify` | Build, Typprüfung, Architekturregeln, Unit-Tests |
| `pnpm lint:deps` | Architekturregeln (dependency-cruiser, `.dependency-cruiser.cjs`) |
| `pnpm test:integration` | Integrationstests; braucht Docker |
| `pnpm stack:up` / `pnpm stack:down` | Umgebung mit API, PostgreSQL, Mosquitto, Node-RED |
| `pnpm test:e2e` | Node-RED-Szenarien gegen die laufende Umgebung (`NODE_RED_URL`, Standard `http://localhost:1880`) |
| `pnpm --filter @wms/api db:migrate` | offene Migrationen ausführen (nach `pnpm build`) |
| `pnpm --filter @wms/api db:migration:create` | neue Migration aus Entity-Änderungen erzeugen |
| `node flows/scripts/build-flows.mjs` | Node-RED-Flows neu erzeugen |

## Profile der API

| `APP_PROFILE` | Verwendung | Test-Endpunkte |
|---|---|---|
| `development` | lokale Entwicklung | nein |
| `test` | automatisierte Tests, Compose-Umgebung | ja (`/test/...`) |
| `production` | Betrieb | nein – das Modul wird nicht geladen |

## Konventionen

- **Mengen und Gewichte** nur als `Quantity` (Dezimal-String + Einheit), in der Datenbank `NUMERIC`. Nie `number`.
- **Fachliche Schlüssel** (Barcode, Lagerplatz, ERP-Code) als Branded Types aus `@wms/shared`; Eingaben mit den zugehörigen Schemas prüfen.
- **Eingaben an Systemgrenzen** mit Zod prüfen (`ZodValidationPipe`); dasselbe Schema für die OpenAPI-Beschreibung verwenden (`ApiDocumentation.registerPath`).
- **Modulgrenzen:** Ein Fachmodul nutzt andere Module nur über deren `index.ts`. Infrastruktur kennt keine Fachmodule. `pnpm lint:deps` prüft das.
- **Schema-Änderungen** nur über Migrationen. Nach einer Entity-Änderung `db:migration:create`, Datei prüfen, in `src/migrations/index.ts` eintragen. `db:migration:create` direkt nach `db:migrate` muss „Keine Schemaänderungen“ melden.

## Events

1. Event im Katalog definieren (`packages/shared/src/events.ts`): `defineEvent('bereich.ereignis', 1, payloadSchema)`.
2. Im Fachmodul in derselben Transaktion wie die Änderung speichern: `outbox.record(tx, MeinEvent, payload, { correlationId })`.
3. Das Outbox-Relay veröffentlicht nach dem Commit auf `wms/bereich/ereignis` (QoS 1).

Garantie: **mindestens einmal**. Konsumenten (auch Node-RED-Flows) müssen Duplikate über die Event-`id` erkennen. Ohne Broker-Verbindung bleiben Events in der Outbox und werden nach der Wiederverbindung gesendet; Fehlversuche werden mit wachsender Wartezeit (1 s … 60 s) wiederholt.

Event-Format:

```json
{
  "id": "5be184a9-d96d-45f6-a923-ef8667a1152b",
  "type": "system.ping",
  "version": 1,
  "occurredAt": "2026-11-16T17:30:57.443Z",
  "source": "wms-api",
  "correlationId": "run-1",
  "payload": { "message": "hallo" }
}
```

## Node-RED-Szenarien

Ein Szenario ist ein eigener Tab in Node-RED:

1. `link in`-Node mit Namen `scenario:<id>` als Einstieg; `msg.scenario` enthält `id`, `runId`, `steps`.
2. Schritte ausführen und je Schritt `msg.scenario.steps.push({ name, passed, detail })`.
3. Auf Ereignisse **mit Timeout** warten, nicht mit festen Pausen; Zuordnung über `correlationId = runId`.
4. Mit `link out` im Modus „return“ enden; `msg.scenario.passed` setzen, bei Fehler `msg.scenario.error`.
5. Szenario im Katalog (Tab „Test-Framework“, Node „Szenario-Katalog“) eintragen.

Die Flows werden mit `flows/scripts/build-flows.mjs` erzeugt; die CI prüft, dass `flows.json` dazu passt. Wer im Node-RED-Editor ändert, überträgt die Änderung in den Generator.

Das Testframework stellt bereit:

| Endpunkt | Antwort |
|---|---|
| `GET /test/scenarios` | `{ scenarios: [{ id, description }] }` |
| `POST /test/scenarios/:id/run` | `{ scenario, runId, passed, durationMs, steps, error? }`; 404 bei unbekanntem Szenario |

## Hinter einem TLS-Proxy

Das API-Image kann eine zusätzliche Zertifizierungsstelle als Build-Secret erhalten; sie landet nicht im Image:

```bash
docker build --secret id=extra_ca,src=/pfad/ca.crt -f apps/api/Dockerfile -t wms-api:dev .
docker compose up -d --wait --no-build
```

## Noch nicht enthalten

- ESLint (Typprüfung und Architekturregeln laufen bereits)
- Authentifizierung der API, MQTT-Benutzer und TLS, Node-RED `adminAuth` – vor jedem Betrieb außerhalb der lokalen Umgebung nötig
- Aufräumen veröffentlichter Outbox-Einträge (Aufbewahrungsfrist)
