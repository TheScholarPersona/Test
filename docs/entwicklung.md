# Entwicklung

## Aufbau

```
apps/api/                  WMS-Kern (NestJS)
apps/web/                  Oberfläche: Leitstand und Scanner (React, Vite), ausgeliefert von der API unter /ui/
  src/config.ts            Konfiguration aus Umgebungsvariablen (Zod-geprüft)
  src/app.module.ts        bindet Infrastruktur und Fachmodule ein
  src/http/                Validierung (ZodValidationPipe), OpenAPI-Dokumentation
  src/infrastructure/
    database/              MikroORM-Konfiguration, Migrationen ausführen
    messaging/             MQTT-Anbindung (EventPublisher)
    outbox/                Transactional Outbox und Relay
  src/migrations/          versionierte Datenbankmigrationen (explizite Liste in index.ts)
  scripts/new-migration.sh neue Migration erzeugen, benennen, eintragen und prüfen
  src/modules/<modul>/     Fachmodule; öffentliche Schnittstelle nur über index.ts
    health/                GET /health
    layout/                Lagerstruktur: Platztypen, Gruppen, Lagerplätze, Sperren
    transport/             Transporteinheiten: Typen, Regeln, TUs, Bewegen, Stapeln
    strategy/              Strategie-Kern: Regelsätze, Entscheidungen; Einlagerung (putaway/), Auslagerung (allocation/)
    movement/              Lagerbewegungen mit Zustandsautomat
    inventory/             Bestand: Produkte/Einheiten, Bestand je TU, Buchungen, Reservierung, Inventur
    receiving/             Wareneingang: Avis, Erfassung, Blind-Erfassung
    transport-order/       Transportaufträge: Zustandsautomat, Start-Steuerung, Zielumleitung
    flow/                  Materialfluss: Routen, Schritte, Action-Matrix, Geräte-Ereignisse
    outbound/              Auslagerung: Aufträge, Zuteilung per Strategie, Picks
    test-support/          Test-Endpunkte, nur im Profil "test"
  test/unit/               Unit-Tests (ohne Datenbank)
  test/integration/        Integrationstests mit Testcontainers
packages/shared/           gemeinsamer Kern: Kennungen, Quantity, Event-Format und -Katalog
packages/scenario-runner/  führt Node-RED-Szenarien aus, schreibt reports/e2e-junit.xml
packages/node-red-nodes/   eigene Node-RED-Nodes (Verbindung, fachliche Nodes, Ereignisse, Test-Nodes)
flows/
  scenarios/*.js           Schritt-Szenarien (lesbare Schrittlisten)
  simulator/config.json    Anlagensimulator: Fahrzeiten, Meldeart je Platz
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
| `pnpm env:init` | `.env` anlegen bzw. ergänzen; leere Passwörter und Tokens werden mit Zufallswerten gefüllt, vorhandene bleiben |
| `pnpm stack:up` / `pnpm stack:down` | Umgebung mit API, PostgreSQL, Mosquitto, Node-RED (`stack:down` löscht die Daten) |
| `pnpm demo:data` | Demo-Daten über die API anlegen (Lager, Bestand, Aufträge, Route; wiederholbar) |
| `pnpm test:web` | Oberfläche im Browser testen (Playwright) gegen die laufende Umgebung |
| `pnpm web:dev` | Entwicklungsserver der Oberfläche (Vite) gegen die laufende API |
| `pnpm test:e2e` | Node-RED-Szenarien und MQTT-Sicherheitsprüfung (nur TLS, keine anonymen Zugriffe, Rechte je Topic) gegen die laufende Umgebung (`NODE_RED_URL`, Standard `http://localhost:1880`) |
| `pnpm --filter @wms/api db:migrate` | offene Migrationen ausführen (nach `pnpm build`) |
| `pnpm --filter @wms/api db:migration:create` | neue Migration aus Entity-Änderungen erzeugen |
| `DATABASE_URL=… apps/api/scripts/new-migration.sh <JJJJMMTTHHMMSS> <name> "<Beschreibung>"` | Migration erzeugen, sprechend benennen, in `index.ts` eintragen und auf Drift prüfen – **leert die Datenbank**, nur mit Wegwerf-DB |
| `node flows/scripts/build-flows.mjs` | Node-RED-Flows neu erzeugen |
| `pnpm catalog:check` / `pnpm catalog:build` | Feature-Katalog prüfen bzw. Ansicht erzeugen (`catalog/dist/index.html`), siehe [feature-katalog.md](feature-katalog.md) |

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

**Anlagenzustand.** Jeder Platz hat einen Zustand laut Anlage (`plc.state`: 0 = in Ordnung, sonst Störungscode, dazu `text` und `changedAt`). Gesetzt wird er über ein Geräte-Ereignis `location-status` mit `plcState` oder direkt mit `PATCH /v1/locations/{id}/plc-state` `{ "plcState": 7, "text": "Antrieb überlastet" }` (Rollen admin, leitstand, anlage). Die Einlagerstrategie vergibt gestörte Plätze nicht (`PLC_FAULT`); gemeldete Ist-Positionen werden weiter gebucht. Änderungen melden `location.plc-state-changed`.

Events: `location-type.*`, `location-group.created|updated|deleted|lock-changed`, `location.created|updated|deleted|lock-changed|plc-state-changed` (Payload-Schemas in `packages/shared/src/layout-events.ts`). Eine Sperränderung an einer Gruppe erzeugt nur ein Event für diese Gruppe; die Wirkung auf Untergruppen und Plätze ergibt sich aus der Hierarchie.

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

**Fehlermeldungen.** `POST /v1/transport-units/{barcode}/errors` `{ code, message? }` hält ein Problem an einer TU fest (Melder aus der Anmeldung, bei Anlagen `device:<Geräte-ID>`; ein Geräte-Ereignis `error` mit Barcode erzeugt die Meldung automatisch). `GET …/errors?state=open|resolved|all` liefert die Historie, `POST …/errors/{errorId}/resolve` `{ resolution? }` erledigt eine Meldung (`UNIT_ERROR_RESOLVED`, wenn schon erledigt), `GET /v1/transport-unit-errors` ist die Arbeitsliste (Standard: offene, älteste zuerst). Meldungen ändern Zustand und Platz der TU nicht; die Historie bleibt erhalten, wenn die TU gelöscht wird.

Events: `transport-unit-type.created|updated|deleted`, `transport-unit.created|moved|updated|state-changed|stacked|unstacked|deleted|error-reported|error-resolved` (Schemas in `packages/shared/src/transport-events.ts`).

## Strategie-Kern (`/v1/strategies`, `/v1/strategy-rule-sets`, `/v1/putaway/…`, `/v1/allocation/…`, `/v1/strategy-decisions`)

Entscheidungen wie „Auf welchen Platz kommt diese TU?“ werden nicht fest programmiert, sondern über versionierte **Regelsätze** konfiguriert. Entscheidungspunkte: `putaway` (Einlagerung) und `allocation` (Auslagerung, siehe unten).

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

**Harte Regeln** prüft der Entscheidungspunkt, nicht die Strategie – keine Strategie kann sie abschalten: alle Platzierungsregeln aus dem TU-Modul, dabei zählen bereits zugewiesene, noch nicht angekommene TUs als belegt; zusätzlich `ALLOCATION_BLOCKED` (Vergabesperre des Platzes) und `PLC_FAULT` (Anlage meldet eine Störung am Platz).

**Endpunkte:**

| Endpunkt | Wirkung |
|---|---|
| `POST /v1/putaway/simulations` `{ barcode, group?, ruleSetId? }` | Probelauf, auch mit Entwurf; speichert und weist nichts zu (`id: null`, `simulated: true`) |
| `POST /v1/putaway/decisions` `{ barcode, group?, assign }` | echte Entscheidung mit dem aktiven Regelsatz; wird gespeichert, Event `putaway.decided`; mit `assign: true` wird der Platz als Ziel der TU gesetzt |
| `GET /v1/strategy-decisions?subject=<barcode>`, `GET …/{id}` | gespeicherte Entscheidungen mit Begründung |

**Begründung (Decision Trace):** Regel und Index, Strategie mit vollständigen Parametern, Fakten, gewählter Kandidat mit Punktzahl, Zusammenfassung (`evaluated`, `eligible`, `excludedByRule`) und bis zu 20 Kandidaten mit Verstößen bzw. Bewertungsanteilen. Wird nichts gewählt, erklärt `note` warum.

**Parallele Zuweisungen:** Der gewählte Platz wird ohne Warten gesperrt (`FOR UPDATE SKIP LOCKED`) und mit frisch gelesener Belegung erneut geprüft. Ist er inzwischen vergeben oder wird er gerade von einer anderen Anfrage vergeben (`LOCATION_BUSY`), wird er ausgeschlossen und neu gewählt (höchstens 5 Versuche, siehe `attempts` und `rejectedOnAssign`). Da nie auf eine Sperre gewartet wird, sind Deadlocks ausgeschlossen; ein Platz, dessen parallele Vergabe doch scheitert, wird in diesem Durchlauf nicht berücksichtigt.

**Auslagerstrategien** (Entscheidungspunkt `allocation`, Felder `product.sku`, `demand.amount`, `demand.unit`, `demand.lot`, `order.priority`, `order.customer`):

| Strategie | Auswahl |
|---|---|
| `fifo` | ältester Zugang zuerst |
| `fefo` | frühestes Mindesthaltbarkeitsdatum zuerst, Posten ohne MHD zuletzt |
| `lifo` | jüngster Zugang zuerst |
| `partial-first` | Anbruch zuerst: kleinste Restmengen zuerst |
| `full-unit` | ganze TU bevorzugen: möglichst ganze Posten (größte, die in den Restbedarf passen), Rest vom kleinsten deckenden Posten |

Gemeinsame Parameter: `group?`, `includeSubgroups` (Standard `true`), `minRemainingDays` (Mindestrestlaufzeit, Standard 0). Harte Regeln: verfügbare Menge > 0 (`NOT_AVAILABLE`), TU `AVAILABLE` (`UNIT_NOT_AVAILABLE`), Platz nicht für Auslagerung gesperrt (`SOURCE_OUTBOUND_BLOCKED`), keine laufende Inventur (`COUNT_IN_PROGRESS`), Mindestrestlaufzeit (`REMAINING_SHELF_LIFE`), geforderte Charge.

Beispiel: Kunde FRISCH bekommt FEFO mit 30 Tagen Restlaufzeit, alle anderen FIFO:

```json
{ "decisionPoint": "allocation", "rules": [
  { "name": "frische", "when": { "field": "order.customer", "op": "eq", "value": "FRISCH" }, "strategy": "fefo", "params": { "minRemainingDays": 30 } },
  { "name": "standard", "when": { "always": true }, "strategy": "fifo", "params": {} } ] }
```

`POST /v1/allocation/simulations` `{ sku, quantity, lot?, customer?, orderPriority?, ruleSetId? }` liefert den Plan (`plan`: Posten und Menge in Reihenfolge, `allocated`, `shortfall`) mit Begründung, ohne zu reservieren. Echte Entscheidungen trifft der Auslagerauftrag; sie werden mit Plan gespeichert (Event `allocation.decided`). Vor der Entscheidung werden alle TUs mit Bestand des Produkts in fester Reihenfolge gesperrt, damit gleichzeitige Zuteilungen nicht denselben Bestand planen.

**Neuen Entscheidungspunkt ergänzen:** Definition mit Feldkatalog und Strategien (Vorbild `strategy/putaway/putaway.point.ts`), in `StrategyRegistry` eintragen, Service für Kontext und Ergebnis.

## Modul Lagerbewegungen (`/v1/movements`)

Eine Lagerbewegung ist der Auftrag, eine TU (samt Stapel) auf ein Ziel zu bringen. Nummer im Format `MV00000001`.

**Anlegen** `POST /v1/movements`:

```json
{ "barcode": "P1", "type": "INBOUND", "target": { "group": "LAGER" }, "priority": "HIGH", "initiator": "erp" }
```

- `type`: `INBOUND`, `RELOCATION`, `REPLENISHMENT`, `OUTBOUND`, `EMPTIES`, `CLEARING`, `MANUAL`
- `target`: fester Platz `{ "location": { "erpCode": "A1" } }` (wird gegen die harten Platzregeln geprüft) oder Gruppe `{ "group": "LAGER" }` – dann wählt der aktive Einlager-Regelsatz den Platz; der Bewegungstyp steht dort als Fakt `request.movementType` zur Verfügung (z. B. `EMPTIES` → Leergutzone)
- Das Ziel wird reserviert (Ziel der TU); findet die Strategie keinen Platz, wird nichts angelegt (`409 NO_TARGET_LOCATION` mit Zusammenfassung der Entscheidung)
- Je TU höchstens eine offene Bewegung (`MOVEMENT_EXISTS`, per Datenbank abgesichert); gestapelte TUs werden über ihre Basis bewegt (`TU_STACKED`)

**Zustände und Aktionen:**

| Aktion | Endpunkt | Von → Nach |
|---|---|---|
| beginnen | `POST …/{number}/start` `{ assignedTo? }` | OPEN → IN_PROGRESS |
| zurückgeben | `POST …/{number}/release` | IN_PROGRESS → OPEN |
| abschließen | `POST …/{number}/complete` `{ location?, mode? }` | OPEN, IN_PROGRESS → DONE |
| stornieren | `POST …/{number}/cancel` `{ reason? }` | OPEN, IN_PROGRESS → CANCELLED |

Andere Übergänge werden mit `409 INVALID_STATE_TRANSITION` abgelehnt; jede Antwort enthält `allowedActions`. Den Zustand direkt zu setzen ist nicht möglich.

**Abschluss** bucht die TU mit allen Regeln der TU-Buchung (`checked`/`physical` wie beim Bewegen). Ohne `location` gilt das Ziel; ein anderer Platz ist eine Abweichung (`completed.deviated`), die Reservierung des ursprünglichen Ziels wird dann aufgehoben. Das Event `movement.completed` nennt den Platz vor (`from`) und nach (`to`) dem Abschluss.

**Storno** hebt die Reservierung des Ziels auf (`releasedTarget` im Event).

**Arbeitsliste:** `GET /v1/movements?state=OPEN,IN_PROGRESS&type=INBOUND` liefert dringendste zuerst (Priorität, dann Alter); weitere Filter `barcode`, `assignedTo`.

**Löschschutz und Historie:** Eine TU mit offener Bewegung und ein Platz, der Ziel einer offenen Bewegung ist, können nicht gelöscht werden (Einwand `open-movements`). Bewegungen selbst werden nie gelöscht: Barcode und Platzkoordinaten bleiben gespeichert, auch wenn TU oder Platz später gelöscht werden (`id: null`).

**Bewegungsgruppen** (`/v1/movement-groups`, Nummer `MG00000001`): mehrere offene oder laufende Bewegungen gemeinsam einem Bediener zuteilen.

| Aktion | Endpunkt | Wirkung |
|---|---|---|
| bilden | `POST /v1/movement-groups` `{ movements, assignedTo?, description? }` | je Bewegung höchstens eine Gruppe (`MOVEMENT_GROUPED`), nur offene/laufende (`MOVEMENT_CLOSED`) |
| ändern | `PATCH …/{number}` `{ add?, remove?, description? }` | nicht mehr, wenn alle Bewegungen beendet sind (`GROUP_CLOSED`) |
| zuteilen | `POST …/{number}/assign` `{ assignedTo \| null }` | laufende Bewegungen wechseln mit zum neuen Bediener |
| beginnen | `POST …/{number}/start` `{ assignedTo? }` | alle offenen Bewegungen starten (Bediener: Angabe, zugeteilter oder Angemeldeter) |
| zurückgeben | `POST …/{number}/release` | alle laufenden Bewegungen wieder öffnen, Zuteilung aufheben |

Abschließen und Stornieren bleiben je Bewegung. Der Zustand der Gruppe wird abgeleitet (`IN_PROGRESS`, sobald eine läuft; `DONE`/`CANCELLED`, wenn alle beendet sind). Die Arbeitsliste filtert mit `GET /v1/movements?group=MG…`. Rechte: bilden, ändern, zuteilen leitstand; beginnen, zurückgeben auch lager.

Events: `movement.created|started|released|completed|cancelled`, `movement-group.created|changed` (Schemas in `packages/shared/src/movement-events.ts`).

Noch nicht enthalten: automatischer Abschluss, wenn die TU ohne Quittung am Ziel gebucht wird.

## Modul Bestand (`/v1/products`, `/v1/stock…`, `/v1/stock-counts`)

Bestand wird **je Transporteinheit** geführt (keine Mandanten). Ein Bestandsposten ist die Menge eines Produkts auf einer TU, getrennt nach Charge (`lot`) und Mindesthaltbarkeit (`bestBefore`); gleiche Merkmale werden zusammengeführt. Der Platzbestand ergibt sich aus den TUs auf dem Platz.

**Produkte und Einheiten:** `POST /v1/products` `{ sku, baseUnit, units: [{ unit: "KAR", factor: "12" }] }`. Bestand wird immer in der Basiseinheit geführt; Abgang, Umbuchung, Reservierung, Korrektur und Inventur nehmen auch alternative Einheiten an und rechnen exakt um (höchstens 3 Nachkommastellen, sonst `INVALID_QUANTITY`). Der Wareneingang bucht in der Basiseinheit. `PUT /v1/products/{sku}/units` ersetzt die Einheiten; die Basiseinheit ist nur ohne Bestand änderbar (`PRODUCT_UNIT_IN_USE`).

**Buchungen** auf einen Posten (`{id}` aus `GET /v1/stock`):

| Buchung | Endpunkt | Journal-Typ | Regeln |
|---|---|---|---|
| Zugang | über den Wareneingang | `RECEIPT` | – |
| Abgang | `POST /v1/stock/{id}/issues` `{ quantity, reference, reservationId? }` | `ISSUE` | höchstens verfügbar; mit `reservationId` wird die Reservierung verbraucht (`EXCEEDS_RESERVATION`) |
| Umbuchung | `POST /v1/stock/{id}/transfers` `{ to, quantity, reference? }` | `TRANSFER_OUT` / `TRANSFER_IN` | Charge und MHD bleiben; auf der Ziel-TU zusammengeführt |
| Korrektur | `POST /v1/stock/{id}/corrections` `{ delta, reason }` | `CORRECTION` | vorzeichenbehaftet, mit Grund |

Kein negativer Bestand (`STOCK_INSUFFICIENT`) und nie unter die Reservierung (`STOCK_RESERVED`); ein Posten auf 0 wird entfernt.

**Reservierung:** `POST /v1/stock/{id}/reservations` `{ quantity, reference }` reserviert verfügbaren Bestand (`STOCK_NOT_AVAILABLE`); `GET /v1/stock-reservations?reference=…`, `DELETE /v1/stock-reservations/{id}`. Jeder Posten zeigt `quantity`, `reserved` und `available`. Die Datenbank sichert zusätzlich `0 ≤ reserved ≤ quantity` ab.

**Abfragen:** `GET /v1/stock?barcode|sku|lot|location|group=…` (Gruppe inkl. Untergruppen); `GET /v1/stock/summary?by=product|location&sku=…&group=…` liefert Summen mit Reservierung, verfügbarer Menge, Anzahl Posten und TUs; `GET /v1/stock-bookings` ist das Journal (neueste zuerst).

**Inventur je TU** (`/v1/stock-counts`):

| Schritt | Endpunkt | Wirkung |
|---|---|---|
| öffnen | `POST /v1/stock-counts` `{ barcode, reference? }` | Soll-Bestand wird festgehalten; **Inventursperre**: andere Buchungen auf der TU → `COUNT_IN_PROGRESS` |
| zählen | `POST …/{number}/result` `{ lines: [{ sku, lot?, bestBefore?, quantity }], countedBy? }` | auch mehrfach; nicht genannte Soll-Zeilen gelten als 0, unbekannte als Fund |
| abschließen | `POST …/{number}/close` | Differenzen als `CORRECTION` mit Bezug `count:<Nummer>`, Sperre aufgehoben |
| abbrechen | `POST …/{number}/cancel` | ohne Buchung |

**Nebenläufigkeit:** Jede Buchung sperrt zuerst die betroffenen TU-Zeilen in fester Reihenfolge (nach id). Gleichzeitige Buchungen auf dieselbe TU laufen dadurch nacheinander, gegenläufige Umbuchungen verklemmen sich nicht, und die Inventursperre wird an genau dieser Stelle geprüft.

**Löschschutz:** Eine TU mit Bestand oder laufender Inventur kann nicht gelöscht werden (Einwände `stock`, `stock-count`).

Events: `product.created|updated`, `stock.received|issued|transferred|corrected|reserved|reservation-released`, `stock-count.changed` (`packages/shared/src/inventory-events.ts`).

Noch nicht enthalten: Seriennummern, Reservierung über mehrere Posten (Bedarf je Produkt – folgt mit der Auslagerung in Schritt 8), zyklische Inventurplanung.

## Modul Wareneingang (`/v1/receiving-orders`, `/v1/receiving-blind-captures`)

**Avis** `POST /v1/receiving-orders`:

```json
{ "orderId": "WE-4711", "supplier": "Lieferant A", "positions": [
  { "kind": "quantity", "sku": "SKU-A", "quantity": { "amount": "10", "unit": "PCS" } },
  { "kind": "unit", "barcode": "P1", "typeCode": "EURO" } ] }
```

Mengenpositionen erwarten eine Menge eines Produkts, TU-Positionen eine ganze TU eines Typs (`typeCode` Pflicht, erwarteter `barcode` z. B. SSCC optional). Positionsnummern werden vergeben, wenn sie fehlen.

**Erfassen** `POST /v1/receiving-orders/{orderId}/captures`:

- Menge: `{ kind: "quantity", sku, quantity, unit: { barcode? | typeCode? }, location, lot?, bestBefore?, putawayGroup? }` – bucht auf eine vorhandene TU oder legt eine neue an (Barcode `TU0000000001`). Die Position wird automatisch gewählt (erste offene mit ausreichender Restmenge). Mehr als avisiert nur, wenn das Produkt es erlaubt (`OVERDELIVERY_NOT_ALLOWED` mit Restmengen, sonst `overdelivered: true`).
- TU: `{ kind: "unit", barcode, typeCode?, location }` – eine vorhandene TU wird physisch auf den Platz gebucht, sonst angelegt.
- Mit `putawayGroup` wird direkt eine Einlagerbewegung (`INBOUND`) angelegt bzw. eine offene wiederverwendet (`movementNumber`).
- Bestand bekommt den Bezug `receiving:<orderId>/<posNo>`.

**Zustände:** Position `OPEN → IN_PROGRESS → COMPLETED`, außerdem `SHORT` (mit Fehlmenge geschlossen) und `CANCELLED`. Der Auftrag folgt aus den Positionen: `OPEN`, `IN_PROGRESS`, `COMPLETED`, `PARTIALLY_COMPLETED` (mindestens eine Fehlmenge oder Storno neben Erfasstem), `CANCELLED`.

| Aktion | Endpunkt | Bedingung |
|---|---|---|
| Position stornieren | `POST …/{orderId}/positions/{posNo}/cancel` `{ reason? }` | nur unberührt (`POSITION_NOT_OPEN`) |
| Position schließen | `POST …/{orderId}/positions/{posNo}/close` `{ reason? }` | nur teilweise erfasst (`POSITION_NOT_IN_PROGRESS`) → `SHORT` |
| Auftrag stornieren | `POST …/{orderId}/cancel` | nur ohne Erfassungen (`CANCELLATION_DENIED`) |
| Auftrag abschließen | `POST …/{orderId}/complete` | schließt teilweise erfasste, storniert unberührte Positionen |

Erfassungen auf einen abgeschlossenen Auftrag: `409 ORDER_CLOSED`. Parallele Erfassungen auf denselben Auftrag werden über eine Zeilensperre des Auftrags serialisiert. `GET …/{orderId}/captures` listet die Erfassungen.

**Ohne Avis** `POST /v1/receiving-blind-captures` `{ sku, quantity, unit, location, lot?, bestBefore? }` – Bezug `receiving:blind`.

Events: `receiving-order.created|state-changed`, `receiving-position.state-changed`, `receiving.captured` (`packages/shared/src/receiving-events.ts`).

Noch nicht enthalten: Qualitätsprüfung/Sperrbestand, Etikettendruck, Lieferanten-Stammdaten, Rückmeldung an ein ERP.

## Modul Transportaufträge (`/v1/transport-orders`)

Ein Transportauftrag bringt eine TU automatisch (z. B. über Fördertechnik) zu einem Zielplatz oder in eine Zielgruppe. Nummer im Format `TO00000001`. Lagerbewegungen (manuell, Bediener) und Transportaufträge (Anlage) sind getrennt; eine TU wird immer nur von einem Auftrag gesteuert (`TU_CLAIMED`).

**Anlegen** `POST /v1/transport-orders`:

```json
{ "barcode": "P1", "target": { "location": { "erpCode": "A1" } }, "priority": "HIGH", "redirect": true, "autoStart": true }
```

TU und Ziel sind Pflicht (O-01), deshalb beginnt ein Auftrag `INITIALIZED`. Mit `autoStart` (Standard) wird sofort gestartet, wenn es geht; sonst wartet er mit `problem` (Code und Grund) und dem Event `transport-order.start-blocked`.

**Zustände:**

| Aktion | Endpunkt | Von → Nach |
|---|---|---|
| starten | `POST …/{number}/start` | INITIALIZED → STARTED (wirft mit Grund, wenn es nicht geht) |
| unterbrechen | `POST …/{number}/interrupt` `{ reason? }` | STARTED → INTERRUPTED |
| fortsetzen | `POST …/{number}/resume` | INTERRUPTED → STARTED |
| abschließen | `POST …/{number}/finish` `{ location?, mode? }` | STARTED → FINISHED |
| stornieren | `POST …/{number}/cancel` `{ reason? }` | INITIALIZED, STARTED, INTERRUPTED → CANCELED |
| scheitern | `POST …/{number}/fail` `{ code?, reason }` | INITIALIZED, STARTED, INTERRUPTED → ONFAILURE |

Endzustände sind final (O-03). `INTERRUPTED` belegt die TU weiter.

**Start-Steuerung:**

| Regel | Umsetzung |
|---|---|
| O-02 | Höchstens ein gestarteter oder unterbrochener Auftrag je TU (`TRANSPORT_ORDER_ACTIVE`); per eindeutigem Teilindex und Sperre der TU-Zeile abgesichert |
| O-04 | Zielplatz bzw. Zielgruppe nicht für Einlagerung gesperrt (`TARGET_LOCKED`); bei Zielplätzen zusätzlich die harten Platzregeln (`PLACEMENT_REJECTED`, z. B. voll) |
| O-05 | Wartende Aufträge einer TU starten nach Priorität, dann Alter |
| O-06 | Nach Abschluss, Storno oder Scheitern startet der nächste wartende Auftrag der TU |
| O-07 | Mit `redirect: true` wird bei gesperrtem oder vollem Zielplatz über die Einlagerstrategie ein Ersatzplatz in dessen Gruppe gewählt (`decisionId`, `redirectedFrom` im Event) |

`POST /v1/transport-orders/start-pending` versucht für alle TUs ohne laufenden Auftrag den nächsten wartenden zu starten (z. B. nach dem Entsperren eines Ziels; eignet sich für einen zeitgesteuerten Node-RED-Flow).

**Abschluss** bucht die TU (Standard `mode: physical`, weil Anlagen Tatsachen melden) auf `location`, sonst den Zielplatz bzw. bei Zielgruppe den aktuellen Platz. `deviated` ist gesetzt, wenn der Platz nicht dem Ziel entspricht bzw. nicht in der Zielgruppe liegt.

**Löschschutz:** TUs mit offenen Aufträgen und Plätze, die Ziel offener Aufträge sind, können nicht gelöscht werden (Einwand `transport-orders`).

Events: `transport-order.created|started|start-blocked|interrupted|resumed|finished|canceled|failed` (`packages/shared/src/transport-order-events.ts`).

## Modul Materialfluss (`/v1/flow/…`)

Ersetzt das TMS-Routing von OpenWMS (Analyse Kap. 3.7, Plan 5.1c). Eine Anlage meldet „TU X steht an Platz Y“, das WMS entscheidet und antwortet mit einem Fahrbefehl. Plätze werden von Anlagen über ihren `plcCode` angesprochen (`{ "plcCode": "CV01" }` ist überall als Platzverweis erlaubt).

**Konfiguration** (wirkt sofort, es gibt keinen Zwischenspeicher):

| Baustein | Endpunkt | Inhalt |
|---|---|---|
| Route | `POST /v1/flow/routes` | `routeId`, `source` und `target` je `{ location }` oder `{ group }`, `steps` |
| Schritte | `PUT /v1/flow/routes/{routeId}/steps` | Nächster-Schritt-Tabelle: steht die TU auf `from`, fährt sie nach `next`; optional nur für einen TU-Typ (`unitType`, hat Vorrang) |
| Action | `POST /v1/flow/actions` | `eventType`, optional `routeId` und `place` (Platz oder Gruppe) → `program` + `params` |
| Programme | `GET /v1/flow/programs` | eingebaute Programme mit JSON-Schema ihrer Parameter |

**Suche** (je eine Datenbankabfrage, vom Spezifischen zum Allgemeinen):

- *Route* für Quelle und Ziel des laufenden Transportauftrags: Quellplatz vor Quellgruppe vor deren Eltern; darin Zielplatz vor Zielgruppe vor deren Eltern.
- *Action* für das Ereignis am gemeldeten Platz: Platz vor Gruppe vor Elterngruppen vor „überall“; je Ort zuerst die Action der gefundenen Route, dann die routenunabhängige.

**Geräte-Ereignis** `POST /v1/flow/events`:

```json
{ "type": "request", "location": { "plcCode": "CV01" }, "barcode": "P1", "deviceId": "SPS1" }
```

`type`: `request` (Zielanfrage), `arrived` (angekommen), `location-status` (Platzzustand, `state: { inbound?, outbound? }`, optional `plcState` für den Anlagenzustand des Platzes), `error` (Störung, `code`, `message`; mit Barcode zusätzlich als Fehlermeldung an der TU erfasst). Anlagenzustand und Fehlermeldung gelten unabhängig von der Action-Matrix. Mit `dryRun: true` wird nur entschieden und begründet, nichts gebucht oder gesendet. Die Antwort enthält die Entscheidung mit Begründung (`trace`) und den Fahrbefehl; zusätzlich geht der Fahrbefehl als Event `flow.command` an die Anlage (Node-RED). Alle Entscheidungen: `GET /v1/flow/decisions?barcode=…`.

| Programm | Ereignisse | Wirkung |
|---|---|---|
| `route-next` | request, arrived | TU auf den Platz buchen; am Zielplatz (bzw. in der Zielgruppe ohne weiteren Schritt) Auftrag abschließen, sonst nächsten Schritt senden |
| `create-order` | request | I-Punkt: unbekannte TU anlegen (`typeCode`), Auftrag zu `target` anlegen und starten, dann wie `route-next` |
| `send-to` | request | fest an `location` schicken (z. B. Klärplatz) |
| `book`, `finish-order` | request, arrived | nur buchen bzw. buchen und Auftrag abschließen |
| `lock-location` | location-status, error | Sperren aus der Meldung (`state`) oder aus `params` übernehmen |
| `lock-group` | location-status, error | Systemstatus: Sperren für den ganzen Bereich (Gruppe des meldenden Platzes oder `params.group`) aus der Meldung (`state`) oder aus `params` |
| `interrupt-order` | error | laufenden Auftrag unterbrechen |
| `node-red` | alle | Event `flow.program-requested` mit `params.flow`; der Node-RED-Flow antwortet z. B. mit `POST /v1/flow/commands` |

**Ergebnisse** (`outcome`): `COMMAND`, `FINISHED`, `HANDLED`, `DELEGATED`, `NO_ACTION`, `NO_NEXT_STEP`. „Keine Route“ für einen laufenden Auftrag erzeugt `flow.no-route`, `NO_ACTION`/`NO_NEXT_STEP` erzeugen `flow.unhandled` – nichts wird still ignoriert (R4). Fachfehler eines Programms (z. B. unbekannte TU) brechen die Verarbeitung ab und kommen als HTTP-Fehler zurück; es wird dann keine Entscheidung gespeichert.

**Löschschutz:** Plätze, die in Routen, Schritten oder Actions vorkommen, können nicht gelöscht werden (Einwand `flow`); Routen mit Actions ebenfalls nicht (`ROUTE_IN_USE`).

Events: `flow.command`, `flow.no-route`, `flow.unhandled`, `flow.program-requested`, `flow.config-changed` (`packages/shared/src/flow-events.ts`).

Noch nicht enthalten: Geräte-Ereignisse per MQTT statt REST, zeitgesteuerte Programme, Lastverteilung auf parallele Strecken.

## Anlagensimulator (Node-RED)

Tab „Anlagensimulator“: Auf jeden `flow.command` fährt die TU mit der Fahrzeit aus `flows/simulator/config.json` (`defaultTravelMs`, `travelMs` je plcCode) zum Ziel und meldet dort `request` oder – wenn der plcCode zu `arrivedPatterns` passt – `arrived`. Aktiv nur mit `SIMULATOR_ENABLED=true` (in Compose Standard).

| Endpunkt (Node-RED, Port 1880) | Zweck |
|---|---|
| `GET /sim/state` | Konfiguration, eingespeiste Störungen, letzte Fahrten mit Ergebnis |
| `POST /sim/faults` `{ plcCode, code?, message? }` | nächste Fahrt zu diesem Platz endet mit `error` am Ausgangsplatz |
| `DELETE /sim/faults` | Störungen entfernen |

Schritt-Szenarien erreichen diese Endpunkte mit `request: () => ({ service: 'simulator', method: 'GET', path: '/sim/state' })`. Tab „Programm: send-to-plc“ ist ein Beispiel für ein Materialfluss-Programm in Node-RED. Szenario `material-flow` prüft den ganzen Ablauf.

**Regelsätze in Szenarien:** Szenarien ersetzen nie einen aktiven Regelsatz; Strategien prüfen sie per Simulation mit einem Entwurf, der danach gelöscht wird. Einzige Ausnahme: `outbound-flow` legt einen FIFO-Standard für `allocation` an und aktiviert ihn, **nur wenn** noch keiner aktiv ist – ohne aktiven Regelsatz kann nicht zugeteilt werden. Dieser Standard bleibt danach bestehen.

## Modul Geschäftspartner (`/v1/partners`)

Kunden, Lieferanten und Spediteure als Stammdaten (`apps/api/src/modules/partner`):

```json
{ "code": "K-1000", "name": "Musterkunde GmbH", "roles": ["CUSTOMER"],
  "address": { "street": "Musterstraße 1", "postalCode": "12345", "city": "Musterstadt", "country": "DE" }, "email": "versand@example.com" }
```

| Aktion | Endpunkt | Hinweis |
|---|---|---|
| anlegen | `POST /v1/partners` | Nummer eindeutig, mind. eine Rolle (`CUSTOMER`, `SUPPLIER`, `CARRIER`), Land als ISO-3166-Alpha-2 |
| ändern | `PATCH /v1/partners/{code}` | einzelne Felder, `null` löscht; `active: false` deaktiviert (gelöscht wird nicht) |
| suchen | `GET /v1/partners?role=…&active=true&q=…` | `q` sucht in Nummer, Name und Ort |

Schreiben ist Stammdatenpflege und damit `admin`. Verwendung: `customerCode` am Auslagerauftrag (Rolle Kunde; Name und Anschrift werden als `shipTo` kopiert, einzelne Felder per `shipTo` überschreibbar) und `supplierCode` am Avis (Rolle Lieferant). Unbekannt → 404 `PARTNER_NOT_FOUND`, deaktiviert → 409 `PARTNER_INACTIVE`, falsche Rolle → 409 `PARTNER_ROLE_MISSING`. Aufträge speichern die Nummer und eine Momentaufnahme der Adresse, keinen Fremdschlüssel – spätere Änderungen am Partner ändern bestehende Aufträge nicht. Der Freitext `customer`/`supplier` bleibt erhalten (für Auslagerstrategien `order.customer`) und ist ohne Angabe die Partnernummer.

Events: `partner.created`, `partner.changed` mit `fields` (`packages/shared/src/partner-events.ts`).

## Modul Auslagerung (`/v1/outbound-orders`, `/v1/outbound-picks`)

**Auftrag** `POST /v1/outbound-orders`:

```json
{ "orderId": "K-4711", "customer": "FRISCH", "customerCode": "K-1000", "priority": "HIGH", "target": { "erpCode": "VERSAND-1" },
  "lines": [ { "sku": "MILCH", "quantity": { "amount": "4", "unit": "KAR" } }, { "sku": "MEHL", "quantity": { "amount": "50", "unit": "KG" }, "lot": "L7" } ] }
```

Mengen werden in die Basiseinheit umgerechnet. `target` ist das Ziel für Bewegungen bzw. Transportaufträge (z. B. Versand- oder Kommissionierplatz).

| Aktion | Endpunkt | Wirkung |
|---|---|---|
| zuteilen | `POST …/{orderId}/allocate` `{ transport: none \| movement \| transport-order }` | offener Bedarf je Position per Auslagerstrategie; jede Entnahme wird als **Pick** reserviert; mehrfach aufrufbar (Nachzuteilung). Optional je TU eine Lagerbewegung (`OUTBOUND`) bzw. ein Transportauftrag zum Ziel; ist die TU schon belegt oder das Ziel abgelehnt, steht der Grund im Pick (`transportNote`), die Zuteilung bleibt gültig |
| quittieren | `POST …/{orderId}/picks/{pickId}/confirm` `{ quantity?, pickedBy? }` | Abgang gegen die Reservierung; weniger als zugeteilt = Fehlmenge, der Rest wird freigegeben und ist neu zuteilbar |
| abschließen | `POST …/{orderId}/complete` `{ reason? }` | nur ohne offene Picks; nicht gedeckte Positionen werden `SHORT` |
| stornieren | `POST …/{orderId}/cancel` `{ reason? }` | offene Picks werden freigegeben, Entnommenes bleibt gebucht |

**Zustände:** Position `OPEN → PARTIALLY_ALLOCATED → ALLOCATED → PICKED` (`SHORT`, `CANCELLED`); Auftrag `CREATED → PARTIALLY_ALLOCATED → ALLOCATED → IN_PICKING → COMPLETED` (`CANCELLED`), abgeleitet aus den Positionen; sind alle Positionen entnommen, schließt der Auftrag automatisch. Zuteilung, Quittung und Storno eines Auftrags laufen über eine Zeilensperre des Auftrags nacheinander.

**Pick-Arbeitsliste:** `GET /v1/outbound-picks?state=OPEN&orderId=…&barcode=…`, sortiert nach Platz. Buchungen tragen den Bezug `outbound:<orderId>/<Position>`.

Events: `outbound-order.created|allocated|state-changed`, `outbound-pick.confirmed`, `allocation.decided` (`packages/shared/src/outbound-events.ts`).

**Packen am Packplatz:** `confirm` mit `packInto: "<Versand-TU>"` bucht die entnommene Menge aus der Reservierung auf die Versand-TU um (`TRANSFER_OUT`/`TRANSFER_IN`), statt sie auszubuchen. Der Packplatz ist das Ziel des Auftrags (`target`); die Versand-TU muss dort stehen (`PACK_STATION_MISSING`, `PACK_UNIT_NOT_AT_STATION`). Ist `packInto` die Pick-TU selbst, geht die ganze Palette in den Versand – nur wenn der Pick den gesamten Posten umfasst (`PACK_IN_PLACE_PARTIAL`). Der Pick zeigt `packedInto`.

Noch nicht enthalten: Wellenbildung, Wegoptimierung der Pick-Liste.

## Modul Versand (`/v1/shipments`)

Sendungen bündeln gepackte TUs eines Auslagerauftrags (`apps/api/src/modules/shipping`):

| Aktion | Endpunkt | Rollen | Wirkung |
|---|---|---|---|
| anlegen | `POST /v1/shipments` `{ orderId, carrierCode?, units? }` | admin, leitstand | Nummer `SH00000001` …, Kunde und Lieferadresse vom Auftrag, Spediteur (Partnerrolle `CARRIER`) |
| TU aufnehmen / herausnehmen | `POST …/{number}/units` `{ barcode }`, `DELETE …/{number}/units/{barcode}` | admin, leitstand | TU muss am Packplatz stehen, Bestand tragen und in keiner anderen offenen Sendung sein |
| verladen | `POST …/{number}/load` `{ barcode, loadedBy? }` | admin, leitstand, lager | Ladekontrolle: fremde TU → `WRONG_UNIT`; alle gescannt → `LOADED` |
| Warenausgang | `POST …/{number}/ship` `{ shippedBy? }` | admin, leitstand | nur `LOADED`: Bestand jeder TU mit Buchungsart `SHIP` (Bezug `shipment:<Nummer>`) ausbuchen, TU löschen, Inhalt in `units[].contents` behalten |
| stornieren | `POST …/{number}/cancel` `{ reason? }` | admin, leitstand | `OPEN`/`LOADED`; TUs und Bestand bleiben |

Zustände `OPEN → LOADED → SHIPPED` (`CANCELLED`). Der Warenausgang läuft in einer Transaktion; die Löschprüfungen der TUs (laufende Bewegungen, Transportaufträge, Inventur, Bestand) sehen dabei die Buchungen derselben Transaktion. Events: `shipment.created`, `shipment.changed` (`change`: `unit-added`, `unit-removed`, `unit-loaded`, `loaded`, `cancelled`), `shipment.shipped` mit Inhalt (`packages/shared/src/shipping-events.ts`).

## Modul Dokumente (`/v1/documents`)

PDF-Dokumente mit internen Barcodes (Code 128 der eigenen Kennungen, keine SSCC); nur lesend, jeder Angemeldete darf sie abrufen. Antwort `application/pdf`, `Content-Disposition: inline`.

| Dokument | Endpunkt | Format |
|---|---|---|
| Palettenetikett | `GET /v1/documents/unit-label/{barcode}` | A6: TU-Barcode, Typ, Platz, Inhalt |
| Versandetiketten | `GET /v1/documents/shipping-labels/{number}?unit=…` | A6, eine Seite je TU: Empfänger, Auftrag, Spediteur, Packstück n von m, Barcodes von Sendung und TU |
| Pickliste | `GET /v1/documents/pick-list/{orderId}` | A4: offene Picks in Platzreihenfolge, Kontrollfeld |
| Lieferschein | `GET /v1/documents/delivery-note/{number}` | A4: Empfänger, Positionen je Produkt/Charge/MHD, Packstücke |
| Ladeliste | `GET /v1/documents/loading-list/{number}` | A4: TUs mit Inhalt, Ladekontrolle, Unterschriftsfeld |

Nach dem Warenausgang stammen die Inhalte aus der Historie der Sendung, vorher aus dem aktuellen Bestand. Erzeugt mit PDFKit 0.20.2 und bwip-js 4.11.4 (beide MIT; Abhängigkeiten MIT bzw. Apache-2.0 für `@swc/helpers`), Schrift Helvetica aus den PDF-Standardschriften. In der Oberfläche: Links in **Versand** (Lieferschein, Ladeliste, Versandetiketten, Palettenetikett je TU), **Auslagerung** (Pickliste) und **Bestand** (Palettenetikett bei gewählter TU).

Zum Ansehen in Tests: `PDF_DUMP_DIR=/pfad pnpm --filter @wms/api test:integration` schreibt die in den Tests abgerufenen PDFs dorthin; `test/integration/support/pdf.ts` liest den Text für Prüfungen aus.

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

## Eigene Node-RED-Nodes (`packages/node-red-nodes`)

Palette „WMS“ in Node-RED, siehe auch `packages/node-red-nodes/README.md`:

| Node | Zweck |
|---|---|
| `wms-config` | Verbindung: URL (`${WMS_API_URL}`), Service-Token (Standard: Umgebungsvariable `WMS_API_TOKEN`), MQTT-Broker für Ereignisse |
| `wms-api` | beliebiger Aufruf der API (`/openapi.json`) |
| `wms-move-tu`, `wms-receive`, `wms-device-event` | TU bewegen, Wareneingang erfassen, Geräte-Ereignis melden |
| `wms-event` | Ereignisse nach Typ (`stock.*`) und Feldern |
| `wms-wait-event` | auf ein Ereignis warten (Timeout statt Pause; Ereignisse kurz vor der Nachricht zählen mit) |
| `wms-test-start`, `wms-assert`, `wms-test-result` | Tests als Flow; das Ergebnis geht auch an das Testframework |

**Leitplanken:** Die Nodes rufen nur die öffentliche API auf, alle Regeln bleiben im WMS. Eine Regelverletzung kommt als Fehler im Flow an: `msg.wmsError` mit `code`, `message`, `statusCode`, `details`; standardmäßig als Node-RED-Fehler für einen Catch-Node, mit „Fehlerausgang“ an Ausgang 2. Felder nehmen feste Werte oder `msg.…`-Verweise; fehlt ein Feld in einem von Hand geschriebenen Flow, gilt derselbe Standard wie im Editor.

**Tests:** `pnpm --filter @wms/node-red-nodes test` (offizieller `node-red-node-test-helper`, ein Test-WMS als HTTP-Server und ein nachgebildeter MQTT-Broker-Node). Die Editor-Dateien `nodes/*.html` erzeugt `scripts/build-html.mjs`; der Test prüft, dass sie aktuell sind. Hinweis: Der Test-Helper erwartet `@node-red/registry` neben `node-red` (npm-Layout); dafür steht eine `packageExtensions`-Angabe in `pnpm-workspace.yaml`.

**In Compose** werden `package.json`, `lib/` und `nodes/` nach `/data/node_modules/@wms/node-red-nodes` eingebunden (ohne Entwicklungsabhängigkeiten); nach Änderungen `docker compose restart node-red`.

**Beispiel-Flows** (Tabs im Generator):

| Tab | Endpunkt / Auslöser | Inhalt |
|---|---|---|
| Beispiel: ERP-CSV → Wareneingang | `POST /examples/erp-receipts` (text/csv: `sku;menge;einheit;tu;tu_typ;platz;charge;mhd`) | je Zeile Wareneingang ohne Avis; Antwort mit Ergebnis oder Fehlercode je Zeile |
| Beispiel: Scan → TU bewegen | `POST /examples/scan` `{ barcode, location }` | geprüfte Buchung; Regelverletzung → Catch-Node → HTTP 409 mit Code |
| Beispiel: Ereignis → Meldung | `stock.issued`, `outbound-order.state-changed`, `flow.no-route` | lesbare Meldung im Debug-Fenster |
| Szenario: nodes-selftest | Testframework | Szenario aus Test-Nodes statt Schrittliste |

Szenario `node-red-examples` prüft die Beispiel-Flows; Schritt-Szenarien erreichen Endpunkte dieses Node-RED mit `service: 'node-red'` (eigene Header über `headers`).

## Oberfläche (`apps/web`)

**Aufrufen:** http://localhost:3000/ui/ (Port `WMS_API_PORT`). Die API liefert die gebaute Oberfläche selbst aus (`WEB_DIST_DIR`, im Image `/app/web`); `/` leitet dorthin weiter. Mit `pnpm demo:data` gibt es gleich etwas zu sehen.

| Seite | Inhalt |
|---|---|
| Übersicht | Kennzahlen, Systemzustand (API, Datenbank, MQTT, Live-Verbindung), letzte Ereignisse |
| Lagerplätze | Gruppen und Plätze mit Belegung, wirksame Sperren (eigene oder geerbte), Sperren setzen/aufheben |
| Bestand | Summen je Produkt oder Platz, Posten mit verfügbarer Menge, Buchungsjournal |
| Wareneingang | Avis anlegen, Positionen, Ware erfassen, abschließen/stornieren |
| Auslagerung | Auftrag anlegen, zuteilen (optional mit Bewegung/Transportauftrag), Picks quittieren oder Fehlmenge melden |
| Transport | offene Transportaufträge und Lagerbewegungen mit den erlaubten Aktionen |
| Materialfluss | Geräte-Ereignis senden (auch als Probelauf) mit Begründung, Entscheidungen, Routen, Action-Matrix |
| Ereignisse | Live-Protokoll mit Filter |
| Scanner | für Handy/Handscanner: TU bewegen, Picks quittieren, Wareneingang; Fokus springt nach jedem Scan zurück |

**Aufbau:** React 19, React Router, TanStack Query, `openapi-fetch`. Die Typen des API-Clients erzeugt `openapi-typescript` aus `apps/web/src/api/openapi.json` (Skript `generate`, läuft vor `dev`, `build`, `typecheck`). Diese Datei ist die Beschreibung der API zum Zeitpunkt des Commits; der Integrationstest `live.integration.test.ts` schlägt fehl, wenn die API davon abweicht – dann mit `UPDATE_OPENAPI=1 pnpm test:integration` neu schreiben. So kann die Oberfläche nicht unbemerkt von der API abweichen.

**Live-Ereignisse:** `GET /v1/events/stream?types=stock.*,…` liefert Ereignisse als Server-Sent Events (Ereignisname `wms`, alle 20 s `ping`). Die API abonniert dafür `wms/#` beim Broker, nicht ihr eigenes Outbox-Relay – so sehen Clients jeder API-Instanz alle Ereignisse. Die Oberfläche lädt bei jedem Ereignis die betroffenen Ansichten neu (`src/live/events.tsx`).

**Entwickeln:** Umgebung starten, dann `pnpm web:dev` (Vite auf `WMS_WEB_DEV_PORT`, Standard 5174, Aufrufe an die API werden weitergeleitet): http://localhost:5174/ui/.

**Tests:** `pnpm --filter @wms/web test` (Hilfsfunktionen), `pnpm test:web` (Playwright: Leitstand am Desktop, Scanner im Handyformat; Testdaten mit eigenem Präfix, danach aufgeräumt). Der Test „Auslagerauftrag“ braucht einen aktiven Auslager-Regelsatz und wird sonst übersprungen.

Die Oberfläche zeigt ohne Sitzung die Anmeldung; Schaltflächen erscheinen nur, wenn die Rolle sie erlaubt (die API prüft trotzdem selbst). Unter **Konto** ändert jeder sein Passwort, unter **Benutzer** (nur admin) werden Benutzer angelegt, Rollen vergeben, gesperrt und Passwörter neu gesetzt. Die Playwright-Tests melden sich einmal als admin an (`WMS_ADMIN_PASSWORD` aus der `.env`).

Noch nicht enthalten: Bearbeiten von Stammdaten (Plätze, Produkte, Regelsätze) in der Oberfläche, Druck (Etiketten, Picklisten).

## Absicherung

Jeder Zugang braucht eine Anmeldung. Alle Geheimnisse stehen in der `.env` (nicht im Repository); `pnpm env:init` erzeugt sie.

| Zugang | Anmeldung | Geheimnis in der `.env` |
|---|---|---|
| Oberfläche und API (Menschen) | Benutzer und Passwort → Sitzungs-Cookie `wms_session` (HttpOnly, SameSite=Strict, 12 h) | `WMS_ADMIN_PASSWORD` für den Benutzer `admin` (wird beim ersten Start angelegt) |
| API (Maschinen) | `Authorization: Bearer <Token>`; Token und Rollen über `AUTH_SERVICE_TOKENS="name:rolle+rolle:token;…"` | `WMS_NODE_RED_API_TOKEN` (Node-RED) |
| MQTT | nur TLS auf Port 8883, Benutzer und Passwort, Rechte je Topic (`docker/mosquitto/acl`) | `WMS_MQTT_API_PASSWORD`, `WMS_MQTT_NODE_RED_PASSWORD`, `WMS_MQTT_HEALTH_PASSWORD` |
| Node-RED-Editor | Benutzer `admin` (`docker/node-red/settings.js`) | `WMS_NODE_RED_ADMIN_PASSWORD` |
| Node-RED-HTTP-Endpunkte (`/test`, `/sim`, `/examples`) | Basic Auth, Benutzer `wms` | `WMS_NODE_RED_HTTP_PASSWORD` |
| PostgreSQL | Benutzer `wms` | `WMS_POSTGRES_PASSWORD` |

**Rollen** (Rechtetabelle in `apps/api/src/modules/auth/domain/policy.ts`; unbekannte schreibende Endpunkte nur für admin; `admin` darf alles):

| Rolle | Darf |
|---|---|
| `admin` | Alles, auch Stammdaten, Regelsätze, Materialfluss-Konfiguration und Benutzer |
| `leitstand` | Aufträge steuern (Wareneingang, Auslagerung, Transport), Sperren, Korrekturen, Inventur |
| `lager` | Ausführen am Scanner: TUs bewegen, Ware erfassen, Picks quittieren, Bewegungen bearbeiten |
| `anlage` | Anlagen und Adapter (Node-RED): Geräte-Ereignisse, Fahrbefehle, Transportaufträge |
| `lesen` | Nur ansehen |

Ohne Anmeldung erreichbar sind nur `/health`, `/openapi.json`, `/v1/auth/login` und die Dateien der Oberfläche. Nach fünf Fehlversuchen ist ein Benutzer fünf Minuten gesperrt. Ereignisse tragen den Auslöser im Feld `actor` (`user:<name>` bzw. `service:<name>`).

**Zertifikate:** Beim ersten Start erzeugt der Dienst `certs` eine lokale Zertifizierungsstelle und das Serverzertifikat für Mosquitto (Namen `mosquitto`, `localhost`, `127.0.0.1`) im Volume `certs`. Für `mosquitto_sub` vom Rechner aus:

```bash
docker compose cp mosquitto:/mosquitto/certs/ca.crt ./ca.crt
mosquitto_sub -h localhost -p 8883 --cafile ca.crt -u wms-api -P "<WMS_MQTT_API_PASSWORD>" -t 'wms/#' -v
```

**Geheimnisse wechseln:** Wert in der `.env` ändern (oder löschen und `pnpm env:init` ausführen) und `docker compose up -d` – die Dienste übernehmen die Werte beim Neustart. Ausnahme: `WMS_POSTGRES_PASSWORD` gilt nur beim Anlegen der Datenbank; danach `pnpm stack:down` (löscht die Daten) oder das Passwort in PostgreSQL selbst ändern. `WMS_ADMIN_PASSWORD` legt `admin` nur beim ersten Start an; später ändert admin sein Passwort unter **Konto**.

**Umstieg von einer älteren Umgebung (ohne Anmeldung):** `git pull`, `pnpm install`, `pnpm env:init`, `pnpm stack:down`, `pnpm stack:up`.

Für den Betrieb außerhalb des eigenen Rechners zusätzlich: die API hinter einen TLS-Proxy (HTTPS) stellen, `AUTH_COOKIE_SECURE=true`, Profil `production` (keine Test-Endpunkte), für Node-RED ein Token mit Rolle `anlage` statt `admin`, ein Zertifikat einer eigenen oder öffentlichen Zertifizierungsstelle für MQTT.

## Ports der lokalen Umgebung

Die Compose-Umgebung belegt auf dem Rechner `3000` (API), `1880` (Node-RED), `5432` (PostgreSQL) und `8883` (MQTT mit TLS), jeweils nur auf `127.0.0.1`. Ist ein Port belegt, z. B. durch eine andere Node-RED-Instanz, in der `.env` ändern:

```bash
pnpm env:init            # falls noch keine .env – dann z. B. WMS_NODE_RED_PORT=1881 eintragen
pnpm stack:up
pnpm test:e2e            # liest dieselbe .env (oder NODE_RED_URL setzen)
```

Innerhalb der Umgebung sprechen die Dienste über ihre Containernamen und festen Ports miteinander; die Einstellung betrifft nur den Zugriff vom Rechner aus. Für die API außerhalb von Docker (nächster Abschnitt) die geänderten Ports in `DATABASE_URL` und `MQTT_URL` verwenden.

## API außerhalb von Docker gegen die Compose-Umgebung

Zum schnellen Ausprobieren von API-Änderungen ohne Image-Build (Werte aus der `.env`, `ca.crt` wie unter *Absicherung* kopiert):

```bash
set -a; . ./.env; set +a
docker compose up -d --no-deps --wait postgres mosquitto
(cd apps/api && pnpm build && APP_PROFILE=test DB_MIGRATE_ON_START=true \
  DATABASE_URL=postgresql://wms:$WMS_POSTGRES_PASSWORD@localhost:5432/wms MQTT_URL=mqtts://localhost:8883 \
  MQTT_USERNAME=wms-api MQTT_PASSWORD=$WMS_MQTT_API_PASSWORD MQTT_CA_FILE=$PWD/../../ca.crt \
  AUTH_ADMIN_PASSWORD=$WMS_ADMIN_PASSWORD AUTH_SERVICE_TOKENS=node-red:admin:$WMS_NODE_RED_API_TOKEN node dist/main.js) &
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
- Anmeldung über einen zentralen Identitätsdienst (OIDC/SSO); bisher eigene Benutzer im WMS
- Aufräumen veröffentlichter Outbox-Einträge (Aufbewahrungsfrist)
