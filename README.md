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
pnpm env:init          # .env mit Zufallspasswörtern anlegen (einmalig)
pnpm verify            # Build, Typprüfung, Architekturregeln, Unit-Tests
pnpm test:integration  # Integrationstests mit PostgreSQL und Mosquitto in Containern
pnpm stack:up          # komplette Umgebung starten
pnpm test:e2e          # Node-RED-Szenarien gegen die Umgebung
pnpm stack:down
```

Nach `pnpm stack:up`:

| Dienst | Adresse |
|---|---|
| Oberfläche | http://localhost:3000/ui/ – Benutzer `admin`, Passwort `WMS_ADMIN_PASSWORD` aus der `.env` |
| API | http://localhost:3000 – `GET /health`, `GET /openapi.json`; sonst Sitzung oder Service-Token |
| Node-RED | http://localhost:1880 – Editor: `admin` / `WMS_NODE_RED_ADMIN_PASSWORD`; `/test/scenarios`: `wms` / `WMS_NODE_RED_HTTP_PASSWORD` |
| MQTT | `mqtts://localhost:8883` – nur TLS mit Benutzer und Passwort |
| PostgreSQL | `postgresql://wms:<WMS_POSTGRES_PASSWORD>@localhost:5432/wms` |

Die Compose-Umgebung läuft im Testprofil. Alle Zugänge sind angemeldet; Details und Rollen: [docs/entwicklung.md#absicherung](docs/entwicklung.md#absicherung).

Weitere Details: [docs/entwicklung.md](docs/entwicklung.md). Was das WMS nachweislich kann: [Feature-Katalog](docs/feature-katalog.md) (`pnpm catalog:build`, dann `catalog/dist/index.html` öffnen).
