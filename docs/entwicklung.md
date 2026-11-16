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
    layout/                Lagerstruktur: Platztypen, Gruppen, Lagerplätze, Sperren
    transport/             Transporteinheiten: Typen, Regeln, TUs, Bewegen, Stapeln
    strategy/              Strategie-Kern: Regelsätze, Entscheidungen; Einlagerung (putaway/)
    test-support/          Test-Endpunkte, nur im Profil "test"
  test/unit/               Unit-Tests (ohne Datenbank)
  test/integration/        Integrationstests mit Testcontainers
packages/shared/           gemeinsamer Kern: Kennungen, Quantity, Event-Format und -Katalog
packages/scenario-runner/  führt Node-RED-Szenarien aus, schreibt reports/e2e-junit.xml
flows/
  scenarios/*.js           Schritt-Szenarien (lesbare Schrittlisten)
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

## Fehlerantworten

Fachliche Fehler haben ein einheitliches Format; `code` ist stabil und für Automatisierung (z. B. Node-RED) gedacht:

```json
{ "statusCode": 409, "error": "Conflict", "code": "LOCK_INHERITED",
  "message": "Einlagersperre kann nicht aufgehoben werden, solange die übergeordnete Gruppe [HOCHREGAL] sperrt",
  "details": { "direction": "inbound", "blockedBy": { "kind": "location-group", "name": "HOCHREGAL" } } }
```

| HTTP | Bedeutung |
|---|---|
| 400 | Feldprüfung fehlgeschlagen (`issues` mit Feldpfad); auch bei unbekannten Feldern |
| 404 | Objekt oder referenziertes Objekt existiert nicht (`…_NOT_FOUND`) |
| 409 | Konflikt mit dem Datenbestand (`…_EXISTS`, `…_IN_USE`, `DUPLICATE`, `CONCURRENT_MODIFICATION`) oder verletzte Geschäftsregel |

## Modul Lagerstruktur (`/v1/location-types`, `/v1/location-groups`, `/v1/locations`)

| Konzept | Regeln |
|---|---|
| Platztyp | Kennung eindeutig; löschbar nur, wenn kein Platz ihn nutzt (`LOCATION_TYPE_IN_USE`) |
| Gruppe | Name eindeutig; übergeordnete Gruppe beim Anlegen, danach fest (keine Zyklen); löschbar nur leer (`LOCATION_GROUP_NOT_EMPTY`) |
| Lagerplatz | Koordinate `BEREICH/GASSE/X/Y/Z`, ERP- und SPS-Code eindeutig; Koordinate und Typ unveränderlich (`LOCATION_ID_IMMUTABLE`, `LOCATION_TYPE_IMMUTABLE`); Gruppe änderbar; Kapazität (`maxTransportUnits`, `maxWeight` in KG) wird ab Schritt 2 durchgesetzt |
| Löschen eines Platzes | andere Module können über `LocationRemovalPolicy` widersprechen (`LOCATION_IN_USE`) |

**Sperren.** Gespeichert wird nur die eigene Sperre (`inbound`, `outbound`, bei Plätzen zusätzlich `allocation`). Wirksam ist eine Ein- oder Auslagersperre, wenn das Objekt selbst oder eine übergeordnete Gruppe sperrt. Jede Antwort enthält je Richtung `own`, `blocked` und `blockedBy` (nächstgelegenes sperrendes Objekt). Zusätzlich sperren ist immer erlaubt; Entsperren ist abgelehnt, solange eine übergeordnete Gruppe sperrt (`LOCK_INHERITED`). Wird die übergeordnete Sperre aufgehoben, bleiben eigene Sperren darunter bestehen.

Sperren ändern: `PATCH /v1/location-groups/{name}/locks` bzw. `PATCH /v1/locations/{id}/locks` mit z. B. `{ "inbound": true, "reason": "Inventur" }`.

Events: `location-type.*`, `location-group.created|updated|deleted|lock-changed`, `location.created|updated|deleted|lock-changed` (Payload-Schemas in `packages/shared/src/layout-events.ts`). Eine Sperränderung an einer Gruppe erzeugt nur ein Event für diese Gruppe; die Wirkung auf Untergruppen und Plätze ergibt sich aus der Hierarchie.

## Modul Transporteinheiten (`/v1/transport-unit-types`, `/v1/transport-units`)

| Konzept | Regeln |
|---|---|
| TU-Typ | Kennung eindeutig; Maße, Leergewicht, zulässige Zuladung; löschbar nur ohne TUs und ohne Verwendung in Stapelregeln anderer Typen (`TU_TYPE_IN_USE`) |
| Platzierungsregeln | `PUT …/{code}/placement-rules` ersetzt die Liste erlaubter Platztypen (mit `privilegeLevel` für die spätere Einlagerstrategie); leere Liste = überall erlaubt |
| Stapelregeln | `PUT …/{code}/stacking-rules`: welche TU-Typen wie oft auf diesen Typ gestapelt werden dürfen; leer = nicht stapelbar |
| TU | Barcode eindeutig, ohne Angabe erzeugt (`TU0000000001`, Datenbanksequenz); Zustand `AVAILABLE`, `BLOCKED`, `QUALITY_CHECK`; Gewicht optional (sonst Leergewicht des Typs); Zuladung wird geprüft (`TU_OVERWEIGHT`) |

**Platzieren (Anlegen, Bewegen, Abstapeln).** Geprüft werden alle Regeln, gemeldet werden alle Verstöße auf einmal:

| Regel | Bedeutung |
|---|---|
| `SOURCE_OUTBOUND_BLOCKED` | Quellplatz (geerbt) für Auslagerung gesperrt |
| `TARGET_INBOUND_BLOCKED` | Zielplatz (geerbt) für Einlagerung gesperrt |
| `LOCATION_FULL` | Höchstzahl direkt abgestellter TUs erreicht (gestapelte TUs zählen nicht; `maxTransportUnits = 0` = keine Abstellung) |
| `WEIGHT_EXCEEDED` | Gewicht aller TUs auf dem Platz inklusive Stapel über dem Höchstgewicht |
| `PLACEMENT_NOT_ALLOWED` | Platztyp laut Platzierungsregeln nicht erlaubt |

`mode: "checked"` (Standard) lehnt bei Verstößen mit `409 PLACEMENT_REJECTED` ab, `details.violations` listet sie. `mode: "physical"` ist für gemeldete Ist-Positionen (Scanner, SPS): Die Buchung wird immer ausgeführt, die Verstöße stehen in der Antwort und im Event `transport-unit.moved`/`created` – Node-RED kann darauf reagieren, z. B. eine Meldung an den Leitstand senden.

Der Zielplatz wird während der Prüfung in der Datenbank gesperrt (`SELECT … FOR UPDATE`); parallele Buchungen auf denselben Platz werden nacheinander geprüft und überbelegen ihn nicht.

**Stapeln.** `POST …/{barcode}/stack` mit `{ "onto": "<barcode>" }`: nur mit Stapelregel und bis zur Höchstzahl (`STACK_FULL`), nur auf demselben Platz, ohne Zyklen; Ablehnung mit `409 STACKING_REJECTED`. Gestapelte TUs lassen sich nicht einzeln bewegen (`TU_STACKED`); wird die Basis bewegt, wandert der ganze Stapel mit (`movedWith` im Event). `POST …/unstack` stellt die TU als eigene Einheit auf denselben Platz (Kapazitätsprüfung wie beim Platzieren).

**Löschschutz.** Ein Lagerplatz mit TUs kann nicht gelöscht werden (`LOCATION_IN_USE`, Einwand `transport-units`). Eine TU mit aufgestapelten TUs ebenfalls nicht (`TU_HAS_CHILDREN`); weitere Einwände anderer Module über `TransportUnitRemovalPolicy` (ab Schritt 5: laufende Transportaufträge).

Events: `transport-unit-type.created|updated|deleted`, `transport-unit.created|moved|updated|state-changed|stacked|unstacked|deleted` (Schemas in `packages/shared/src/transport-events.ts`).

## Strategie-Kern (`/v1/strategies`, `/v1/strategy-rule-sets`, `/v1/putaway/…`, `/v1/strategy-decisions`)

Entscheidungen wie „Auf welchen Platz kommt diese TU?“ werden nicht fest programmiert, sondern über versionierte **Regelsätze** konfiguriert. Bisheriger Entscheidungspunkt: `putaway` (Einlagerung).

**Ablauf einer Entscheidung:** Fakten ermitteln → erste zutreffende Regel wählen → deren Strategie mit Parametern ausführen → Kandidaten gegen die **harten Regeln** prüfen → geeignete Kandidaten bewerten → Ergebnis mit Begründung speichern.

`GET /v1/strategies` liefert je Entscheidungspunkt die Felder für Bedingungen (mit Typ) und die Strategien mit JSON-Schema ihrer Parameter.

**Regelsatz:** geordnete Liste von Regeln; die erste zutreffende gilt, die letzte muss `{ "always": true }` haben (Rückfall).

```json
{ "decisionPoint": "putaway", "description": "Schweres auf den Boden",
  "rules": [
    { "name": "schwer", "when": { "field": "unit.weightKg", "op": "gt", "value": "500" },
      "strategy": "first-free", "params": { "group": "ZONE-BODEN" } },
    { "name": "anfrage", "when": { "field": "request.group", "op": "exists" },
      "strategy": "first-free", "params": {} },
    { "name": "standard", "when": { "always": true },
      "strategy": "weighted", "params": { "group": "LAGER", "weights": { "emptiness": 2, "privilege": 5 } } }
  ] }
```

| Bedingung | Form |
|---|---|
| Vergleich | `{ "field", "op", "value" }` mit `eq`, `neq`, `in`, `notIn` (Liste), `gt`, `gte`, `lt`, `lte` (Zahl/Dezimal), `exists` (ohne Wert) |
| Verknüpfung | `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": {...} }`, `{ "always": true }` |

Dezimalfelder (z. B. `unit.weightKg`) werden exakt verglichen. Beim Speichern werden Felder, Operatoren, Werttypen, Strategien und Parameter vollständig geprüft (`400 RULE_SET_INVALID`, `details.errors` mit Pfad). Bedingungen sind Daten, kein ausführbarer Code.

**Lebenszyklus:** `POST /v1/strategy-rule-sets` legt einen Entwurf (`DRAFT`) mit der nächsten Version an; Entwürfe sind änderbar (`PUT`) und löschbar. `POST …/{id}/activate` aktiviert ihn und archiviert den bisher aktiven (höchstens ein aktiver je Entscheidungspunkt, auch per Datenbank abgesichert). Aktive und archivierte Regelsätze sind unveränderlich (`RULE_SET_NOT_DRAFT`).

**Einlagerstrategien:**

| Strategie | Parameter | Auswahl |
|---|---|---|
| `first-free` | `group?`, `includeSubgroups` (Standard `true`) | erster geeigneter Platz nach `sortOrder`, dann Koordinate |
| `weighted` | zusätzlich `weights: { sortOrder, emptiness, privilege }` (je 0–10, Standard 1) | höchste Summe der gewichteten, auf 0…1 normierten Kriterien: frühe Sortierung, Leere des Platzes, Vorrang des Platztyps laut Platzierungsregel |

Ohne `group` in der Regel gilt die Suchgruppe aus der Anfrage (`NO_SEARCH_GROUP`, wenn beides fehlt).

**Harte Regeln** prüft der Entscheidungspunkt, nicht die Strategie – keine Strategie kann sie abschalten: alle Platzierungsregeln aus dem TU-Modul, dabei zählen bereits zugewiesene, noch nicht angekommene TUs als belegt; zusätzlich `ALLOCATION_BLOCKED` (Vergabesperre des Platzes).

**Endpunkte:**

| Endpunkt | Wirkung |
|---|---|
| `POST /v1/putaway/simulations` `{ barcode, group?, ruleSetId? }` | Probelauf, auch mit Entwurf; speichert und weist nichts zu (`id: null`, `simulated: true`) |
| `POST /v1/putaway/decisions` `{ barcode, group?, assign }` | echte Entscheidung mit dem aktiven Regelsatz; wird gespeichert, Event `putaway.decided`; mit `assign: true` wird der Platz als Ziel der TU gesetzt |
| `GET /v1/strategy-decisions?subject=<barcode>`, `GET …/{id}` | gespeicherte Entscheidungen mit Begründung |

**Begründung (Decision Trace):** Regel und Index, Strategie mit vollständigen Parametern, Fakten, gewählter Kandidat mit Punktzahl, Zusammenfassung (`evaluated`, `eligible`, `excludedByRule`) und bis zu 20 Kandidaten mit Verstößen bzw. Bewertungsanteilen. Wird nichts gewählt, erklärt `note` warum.

**Parallele Zuweisungen:** Der gewählte Platz wird ohne Warten gesperrt (`FOR UPDATE SKIP LOCKED`) und mit frisch gelesener Belegung erneut geprüft. Ist er inzwischen vergeben oder wird er gerade von einer anderen Anfrage vergeben (`LOCATION_BUSY`), wird er ausgeschlossen und neu gewählt (höchstens 5 Versuche, siehe `attempts` und `rejectedOnAssign`). Da nie auf eine Sperre gewartet wird, sind Deadlocks ausgeschlossen; ein Platz, dessen parallele Vergabe doch scheitert, wird in diesem Durchlauf nicht berücksichtigt.

**Neuen Entscheidungspunkt ergänzen:** Definition mit Feldkatalog und Strategien (Vorbild `strategy/putaway/putaway.point.ts`), in `StrategyRegistry` eintragen, Service für Kontext und Ergebnis.

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

### Schritt-Szenarien (empfohlen)

Für fachliche Abläufe genügt eine Schrittliste in `flows/scenarios/<id>.js`; der Generator macht daraus einen Tab, die gemeinsame **Schritt-Engine** führt sie aus. Beispiel: `flows/scenarios/layout-locks.js`.

```js
registerScenario({
  id: 'mein-szenario',
  description: 'Was geprüft wird',
  init: (runId) => ({ name: `SZ-${runId.slice(-8).toUpperCase()}` }),   // eindeutige Testdaten je Lauf
  steps: [
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.name } }), expectStatus: 201 },
    { name: 'Event empfangen', event: (e, v) => e.type === 'location-group.created' && e.payload.name === v.name },
    { name: 'Aufräumen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.name}` }), expectStatus: 204 },
  ],
});
```

| Feld | Bedeutung |
|---|---|
| `request(v)` | HTTP-Aufruf gegen die API; `null` überspringt den Schritt |
| `expectStatus` | erwarteter HTTP-Status |
| `check(body, v)` | Fehlertext zurückgeben, wenn die Antwort nicht passt, sonst `null` |
| `save(body, v)` | Werte für spätere Schritte in `v` ablegen (z. B. erzeugte IDs) |
| `event(e, v)` | wartet auf ein MQTT-Event unter `wms/#`, für das die Funktion `true` liefert (Timeout `SCENARIO_EVENT_TIMEOUT_MS`) |
| `cleanup: true` | Aufräumschritt: läuft auch nach einem Fehler; davor liegende normale Schritte werden nach einem Fehler übersprungen |

Nach dem Ändern: `node flows/scripts/build-flows.mjs` (prüft auch die Syntax aller Funktions-Nodes), dann Node-RED neu starten (`docker compose restart node-red`).

### Eigene Szenario-Tabs

Für Abläufe, die nicht in das Schrittschema passen, ist ein Szenario ein eigener Tab in Node-RED (Beispiel: `system-ping`):

1. `link in`-Node mit Namen `scenario:<id>` als Einstieg; `msg.scenario` enthält `id`, `runId`, `steps`.
2. Schritte ausführen und je Schritt `msg.scenario.steps.push({ name, passed, detail })`.
3. Auf Ereignisse **mit Timeout** warten, nicht mit festen Pausen; Zuordnung über `correlationId = runId`.
4. Mit `link out` im Modus „return“ enden; `msg.scenario.passed` setzen, bei Fehler `msg.scenario.error`.
5. Szenario im Generator unter „Szenario-Katalog“ eintragen.

Die Flows werden mit `flows/scripts/build-flows.mjs` erzeugt; die CI prüft, dass `flows.json` dazu passt. Wer im Node-RED-Editor ändert, überträgt die Änderung in den Generator.

Das Testframework stellt bereit:

| Endpunkt | Antwort |
|---|---|
| `GET /test/scenarios` | `{ scenarios: [{ id, description }] }` |
| `POST /test/scenarios/:id/run` | `{ scenario, runId, passed, durationMs, steps, error? }`; 404 bei unbekanntem Szenario |

## API außerhalb von Docker gegen die Compose-Umgebung

Zum schnellen Ausprobieren von API-Änderungen ohne Image-Build:

```bash
docker compose up -d --no-deps --wait postgres mosquitto
(cd apps/api && pnpm build && APP_PROFILE=test DB_MIGRATE_ON_START=true \
  DATABASE_URL=postgresql://wms:wms@localhost:5432/wms MQTT_URL=mqtt://localhost:1883 node dist/main.js) &
WMS_API_URL=http://<Gateway-IP des Compose-Netzes>:3000 docker compose up -d --no-deps --wait node-red
pnpm test:e2e
```

Die Gateway-IP liefert `docker network inspect wms_default -f '{{(index .IPAM.Config 0).Gateway}}'` (unter Docker Desktop stattdessen `host.docker.internal`).

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
