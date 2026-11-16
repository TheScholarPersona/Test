# WMS

Warehouse-Management-System in TypeScript, fachlich angelehnt an die öffentlich analysierten OpenWMS.org-Komponenten
(Analyse und Plan: [docs/openwms-analyse.md](docs/openwms-analyse.md)). Der Code ist neu geschrieben; „OpenWMS“ ist nicht der Name dieses Projekts.

| Baustein | Technik |
|---|---|
| Kern (`apps/api`) | Node.js 22, TypeScript 6, NestJS 12, modularer Monolith |
| Persistenz | PostgreSQL 16, MikroORM 7, versionierte Migrationen |
| Events | Transactional Outbox → MQTT (Mosquitto), Topics `wms/<bereich>/<ereignis>` |
| Gemeinsamer Kern (`packages/shared`) | Kennungen als Branded Types, `Quantity` auf Dezimalbasis, Event-Format |
| Integration und Systemtests | Node-RED (`flows/`) |
| Tests | Vitest, Testcontainers, Node-RED-Szenarien mit JUnit-Bericht |

## Schnellstart

Voraussetzungen: Node.js ≥ 22.17, pnpm 10 (`corepack enable`), Docker mit Compose.

```bash
pnpm install
pnpm verify            # Build, Typprüfung, Architekturregeln, Unit-Tests
pnpm test:integration  # Integrationstests mit PostgreSQL und Mosquitto in Containern
pnpm stack:up          # komplette Umgebung starten
pnpm test:e2e          # Node-RED-Szenarien gegen die Umgebung
pnpm stack:down
```

Nach `pnpm stack:up`:

| Dienst | Adresse |
|---|---|
| API | http://localhost:3000 – `GET /health`, `GET /openapi.json` |
| Node-RED | http://localhost:1880 – Editor und Szenario-Endpunkte `/test/scenarios` |
| MQTT | `mqtt://localhost:1883` – z. B. `mosquitto_sub -t 'wms/#' -v` |
| PostgreSQL | `postgresql://wms:wms@localhost:5432/wms` |

Die Compose-Umgebung ist nur für Entwicklung und Tests gedacht (Testprofil, keine Anmeldung an MQTT und Node-RED).

Weitere Details: [docs/entwicklung.md](docs/entwicklung.md).
