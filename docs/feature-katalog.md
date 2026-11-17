# Feature-Katalog

Der Feature-Katalog beschreibt, was das WMS **nachweislich** kann – fachlich verständlich, mit technischen Details zum Aufklappen. Er richtet sich an Entwicklung und Produktteam.

```bash
pnpm catalog:check                     # Katalog gegen den Code prüfen (läuft auch in pnpm test und in der CI)
pnpm catalog:build                     # Ansicht erzeugen: catalog/dist/index.html im Browser öffnen
pnpm catalog:build --reports reports   # dto., Nachweise gegen die JUnit-Berichte des letzten Testlaufs
```

| Ort | Inhalt |
|---|---|
| `catalog/catalog.yaml` | Taxonomie: Funktionsbereiche, Feature-Gruppen, Zuständigkeiten (`owns`), technische Ausnahmen |
| `catalog/features/<bereich>.yaml` | **Katalog** – nur nachweislich verfügbare Features |
| `catalog/review.yaml` | **Prüfbestand** – vorhanden, aber unvollständig, deaktiviert oder nicht nachgewiesen |
| `packages/feature-catalog` | Datenmodell (Zod), automatische Bestandsaufnahme, Prüfungen, Ansicht |
| `catalog/dist/` | erzeugte Ansicht und `catalog.json` (nicht im Repository) |

Die YAML-Dateien sind die einzige Quelle. Was sich aus dem Code ableiten lässt, wird **nicht** abgeschrieben, sondern beim Prüfen und Erzeugen ergänzt: Beschreibung der Endpunkte (OpenAPI), Rollen je Endpunkt (Rechtetabelle der API), Testergebnisse (JUnit-Berichte), aufrufende Tests (statische Erkennung). Die Applikation selbst bleibt unverändert; das Werkzeug liest nur.

## 1. Analyse: Woraus sich Fähigkeiten automatisch erkennen lassen

| Quelle | Erkannt | Verlässlichkeit |
|---|---|---|
| `apps/web/src/api/openapi.json` | 125 Endpunkte mit Methode, Pfad, Zweck, Tag | hoch – ein Integrationstest hält die Datei deckungsgleich mit der laufenden API |
| `packages/shared/src` (`defineEvent`) | 60 Ereignistypen | hoch – zentrale, versionierte Registrierung |
| `apps/web/src/App.tsx` (`<Route>`) | 11 Seiten der Oberfläche | hoch |
| `packages/node-red-nodes/package.json` | 10 Node-RED-Nodes | hoch |
| `flows/scenarios`, Flow-Generator | 12 Node-RED-Szenarien | hoch |
| `apps/api/src/modules/auth/domain/policy.ts` | Rollen je Endpunkt | hoch – dieselbe Funktion, die die API zur Laufzeit nutzt |
| Integrationstests, Browser-Tests, Szenarien | welcher Test welchen Endpunkt aufruft | **Heuristik** – erkennt Aufrufe mit Methode und Pfad im Quelltext; Hilfsfunktionen wie `post(id, 'issues')` bleiben unsichtbar |
| JUnit-Berichte (`reports/*junit*.xml`) | ob ein Test bestanden hat | hoch – aus der CI |

Fachliche Module der API (`apps/api/src/modules/*`): layout, transport, strategy, movement, inventory, receiving, transport-order, flow, outbound, auth, health, test-support. Sie bilden zusammen mit Oberfläche, Node-RED und Ereignissen die Grundlage der Taxonomie.

**Was sich nicht automatisch erkennen lässt:** der fachliche Zuschnitt eines Features (welche Endpunkte, Ereignisse und Seiten zusammen *eine* Fähigkeit ergeben), Nutzen, Regeln und Einstellmöglichkeiten. Das pflegt ein Mensch – die Prüfung sorgt dafür, dass nichts vergessen wird und nichts veraltet.

## 2. Taxonomie

**Funktionsbereich → Feature-Gruppe → Feature.** Bereiche sind stabil und am fachlichen Lagerablauf orientiert, nicht an Code-Modulen. Gruppen werden beim Katalogisieren eines Bereichs festgelegt.

| Bereich | Zuständig für (Auszug) |
|---|---|
| Lagerstruktur | `/v1/locations`, `/v1/location-groups`, `/v1/location-types`, `location*`-Ereignisse, `/lagerplaetze` |
| Transporteinheiten | `/v1/transport-units`, `/v1/transport-unit-types`, `wms-move-tu` |
| Strategien und Regeln | `/v1/strategies`, `/v1/strategy-rule-sets`, `/v1/putaway`, `/v1/allocation`, `/v1/strategy-decisions` |
| Bestand | `/v1/products`, `/v1/stock…`, `/v1/stock-counts`, `product`/`stock`/`stock-count`-Ereignisse, `/bestand` |
| Wareneingang | `/v1/receiving-…`, `wms-receive`, `/wareneingang` |
| Lagerbewegungen | `/v1/movements` |
| Transportaufträge | `/v1/transport-orders`, `/transport` |
| Materialfluss und Anlagen | `/v1/flow`, `wms-device-event`, `/materialfluss` |
| Auslagerung | `/v1/outbound-…`, `/auslagerung` |
| Integration und Automatisierung | `/v1/events`, `/test`, `system`-Ereignisse, übrige Node-RED-Nodes, `/ereignisse` |
| Bedienoberfläche | `/`, `/scanner/*` |
| Sicherheit und Betrieb | `/v1/auth`, `/v1/users`, `/health`, `/konto`, `/benutzer` |

**Zuschnitt eines Features:** eine Fähigkeit, die ein Anwender oder System als Ganzes nutzt („Bestand reservieren und freigeben“), nicht ein einzelner Endpunkt. Ein Feature bündelt die dafür nötigen Endpunkte, Ereignisse, Seiten und Nodes. Auch Qualitätsmerkmale mit fachlicher Wirkung sind Features („Sichere Buchungen bei gleichzeitigem Zugriff“). Mehrere Features dürfen denselben Bestandteil nennen.

## 3. Datenmodell

Ein Eintrag (Katalog und Prüfbestand haben denselben Aufbau; Schema: `packages/feature-catalog/src/schema.ts`):

| Feld | Ebene | Inhalt |
|---|---|---|
| `id` | – | stabile Kennung `<bereich>.<name>`; wird nie wiederverwendet |
| `title`, `summary` | fachlich | Name und Nutzen in einem Satz |
| `description` | fachlich | was die Funktion leistet |
| `usage[]` | fachlich | Bedienung je Bedienweg: `leitstand`, `scanner`, `api`, `node-red`, `mqtt` |
| `rules[]` | fachlich | Regeln und Grenzen (mit Fehlercodes) |
| `settings[]` | fachlich | was sich einstellen lässt und wo |
| `dependsOn[]` | fachlich | vorausgesetzte Features (umgekehrt zeigt die Ansicht „Grundlage für“) |
| `technical.components[]` | technisch | Quellcode-Dateien (müssen existieren) |
| `technical.endpoints[]` | technisch | `METHODE /pfad` wie in OpenAPI |
| `technical.events.emits[]` / `consumes[]` | technisch | Ereignistypen |
| `technical.uiRoutes[]`, `technical.nodeRedNodes[]` | technisch | Seiten der Oberfläche, Node-RED-Nodes |
| `technical.notes[]` | technisch | Tabellen, Fehlercodes, Hinweise |
| `evidence[]` | Nachweis | `scenario` (Szenario-Kennung) oder `unit`/`integration`/`web-e2e` (Datei + Testtitel); im Katalog Pflicht |
| `comparisons{}` | Vergleich | je System (z. B. `openwms`) `status` (`gleichwertig`, `erweitert`, `eingeschraenkt`, `neu`, `abweichend`), `note`, `refs` – vorbereitet, noch leer |
| `state`, `reason` | nur Prüfbestand | `unvollstaendig`, `deaktiviert` oder `nicht-nachgewiesen` und warum |

**Abgeleitet, nicht gepflegt:** Rollen (aus den ändernden Endpunkten eines Features, sonst den lesenden), Bedienwege, Nachweisstatus, aufrufende Tests, Zweck der Endpunkte.

**Nachweisstatus** eines Features in der Ansicht:

| Status | Bedeutung |
|---|---|
| nachgewiesen | alle Nachweise haben im letzten Testlauf bestanden (nur mit `--reports`) |
| Nachweis vorhanden | Tests/Szenarien existieren, Ergebnis unbekannt (ohne Testberichte erzeugt) |
| nicht nachgewiesen | ein Nachweis fehlt, ist fehlgeschlagen, übersprungen oder lief nicht |

## 4. Automatische Prüfungen

| Prüfung | Stufe | Wann |
|---|---|---|
| YAML entspricht dem Datenmodell; Kennungen eindeutig; Gruppen und Abhängigkeiten existieren | Fehler | immer |
| Verweise ins Leere: Endpunkt, Ereignis, Route, Node, Quelldatei, Szenario oder Testtitel gibt es nicht (mehr) | Fehler | immer |
| Bestandteil eines **katalogisierten** Bereichs ist keinem Eintrag und keiner Ausnahme zugeordnet (z. B. neuer Endpunkt) | Fehler | immer |
| Nachweis eines Katalog-Features ist fehlgeschlagen, übersprungen oder lief nicht | Fehler | mit `--reports` (CI-Job „Feature-Katalog“) |
| Endpunkt eines Features, den kein Test erkennbar aufruft | Warnung | immer |
| Bestandteil ohne zuständigen Bereich (`owns` fehlt) | Warnung | immer |
| Bereich noch offen: Anzahl nicht zugeordneter Bestandteile | Hinweis | immer |

Die Prüfung **legt nie Features an**. Sie meldet, was zugeordnet werden muss; ob daraus ein neues Feature, eine Erweiterung eines bestehenden, ein Prüfbestand-Eintrag oder eine begründete Ausnahme (`exclusions` in `catalog.yaml`) wird, entscheidet ein Mensch.

**In der CI:** Der Job *verify* prüft statisch (der Katalogtest läuft mit den Unit-Tests, dazu `pnpm catalog:check`) und sichert die JUnit-Berichte der Unit-Tests (API, Node-RED-Nodes) und der Integrationstests. Der Job *Feature-Katalog* läuft nach *verify* und *e2e*, holt alle JUnit-Berichte (Unit-, Integrations-, Szenario- und Browser-Tests), prüft jedes Katalog-Feature gegen die Ergebnisse und legt die Ansicht als Artefakt `feature-katalog` ab.

## 5. Pflege

| Anlass | Vorgehen |
|---|---|
| Neuer Endpunkt / neues Ereignis in einem katalogisierten Bereich | CI meldet `UNASSIGNED`. Bestehendem Feature zuordnen, neues Feature anlegen (mit Nachweis) oder in den Prüfbestand bzw. als Ausnahme eintragen. |
| Neues Feature | Eintrag in `features/<bereich>.yaml` mit mindestens einem Nachweis; ohne Test zuerst in `review.yaml`. |
| Endpunkt, Test oder Datei umbenannt/entfernt | CI meldet `UNKNOWN_*`. Verweis anpassen oder Eintrag in den Prüfbestand verschieben. |
| Test schlägt fehl | Job *Feature-Katalog* meldet `EVIDENCE_FAILED`; das Feature gilt als nicht nachgewiesen, bis der Test wieder grün ist. |
| Prüfbestand-Eintrag bekommt einen Test | Eintrag mit Nachweis nach `features/<bereich>.yaml` verschieben. |
| Bereich fertig katalogisiert | In `catalog.yaml` `status: katalogisiert` setzen – ab dann sind Lücken Fehler. |

## 6. Stand der Bestandsaufnahme

Alle 12 Bereiche sind katalogisiert (`status: katalogisiert`); jeder erkannte Bestandteil ist einem Feature zugeordnet. Mit den Testberichten aller Testarten (Unit, Integration, Node-RED-Szenarien, MQTT-Sicherheit, Browser) sind **alle 72 Features im Testlauf nachgewiesen; der Prüfbestand ist leer**.

| Bereich | Features | Erkannte Bestandteile |
|---|---|---|
| Lagerstruktur | 5 | 29 |
| Transporteinheiten | 8 | 27 |
| Strategien und Regeln | 7 | 15 |
| Bestand | 12 | 30 |
| Wareneingang | 4 | 16 |
| Lagerbewegungen | 3 | 12 |
| Transportaufträge | 2 | 19 |
| Materialfluss und Anlagen | 6 | 21 |
| Auslagerung | 4 | 13 |
| Integration und Automatisierung | 7 | 11 |
| Bedienoberfläche | 5 | 2 |
| Sicherheit und Betrieb | 9 | 11 |
| **Summe** | **72** | **206** |

**Festlegungen** (Produktentscheidung nach dem Pilot):

- Eine Funktion, die nur über API oder Node-RED bedienbar ist, ist **nicht** unvollständig; die API ist ein vollwertiger Bedienweg.
- Ein Feature ist eine nutzbare Fähigkeit, kein einzelner Endpunkt.
- Eine Seite der Oberfläche oder ein Endpunkt ohne eigenen Test steht im Prüfbestand, auch wenn die Fachfunktion dahinter nachgewiesen ist.

**Abbau des Prüfbestands:** Die 14 Einträge nach der ersten Bestandsaufnahme wurden mit Tests nachgewiesen und sind jetzt Teil der Features: Lese- und Änderungsendpunkte (Integrationstests), die Seiten Wareneingang, Transport, Materialfluss, Ereignisse, Konto und Benutzer sowie Picks am Scanner (Browser-Tests in `apps/web/e2e/seiten.spec.ts`, `auth.spec.ts`, `scanner.spec.ts`) und die MQTT-Absicherung (`packages/scenario-runner/test/security.test.ts`, läuft mit `pnpm test:e2e` gegen die Umgebung).

**Grenze der Erkennung:** „Aufgerufen in“ erkennt Aufrufe mit Methode und Pfad im Quelltext (auch Template-Ausdrücke und `fetch` ohne Methode). Aufrufe über Hilfsfunktionen wie `post(id, 'issues')` bleiben unsichtbar; deshalb ist das nur eine Warnung. Verbindlich sind die ausdrücklichen Nachweise und ihre Testergebnisse.
