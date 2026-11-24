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
| `catalog/comparisons/<system>.yaml` | **Lücken** gegenüber einem Vergleichssystem (z. B. OpenWMS) |
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
| Sicherheit und Betrieb | `/v1/auth`, `/v1/users`, `/health`, `/metrics`, `/konto`, `/benutzer` |
| Feature-Katalog | der Katalog selbst (keine Bestandteile der Applikation; Bedienweg `entwicklung`) |

**Zuschnitt eines Features:** eine Fähigkeit, die ein Anwender oder System als Ganzes nutzt („Bestand reservieren und freigeben“), nicht ein einzelner Endpunkt. Ein Feature bündelt die dafür nötigen Endpunkte, Ereignisse, Seiten und Nodes. Auch Qualitätsmerkmale mit fachlicher Wirkung sind Features („Sichere Buchungen bei gleichzeitigem Zugriff“). Mehrere Features dürfen denselben Bestandteil nennen.

## 3. Datenmodell

Ein Eintrag (Katalog und Prüfbestand haben denselben Aufbau; Schema: `packages/feature-catalog/src/schema.ts`):

| Feld | Ebene | Inhalt |
|---|---|---|
| `id` | – | stabile Kennung `<bereich>.<name>`; wird nie wiederverwendet |
| `title`, `summary` | fachlich | Name und Nutzen in einem Satz |
| `description` | fachlich | was die Funktion leistet |
| `usage[]` | fachlich | Bedienung je Bedienweg: `leitstand`, `scanner`, `api`, `node-red`, `mqtt`, `entwicklung` (Kommandozeile und CI) |
| `rules[]` | fachlich | Regeln und Grenzen (mit Fehlercodes) |
| `acceptance[]` | Nachweis | prüfbare Akzeptanzkriterien: `id`, `kind` (`effekt` = beobachtbare Wirkung, `regel` = Grenze), `text`, bei Regeln mit Fehlercode `code`; im Katalog mindestens ein `effekt` |
| `settings[]` | fachlich | was sich einstellen lässt und wo |
| `dependsOn[]` | fachlich | vorausgesetzte Features (umgekehrt zeigt die Ansicht „Grundlage für“) |
| `technical.components[]` | technisch | Quellcode-Dateien (müssen existieren) |
| `technical.endpoints[]` | technisch | `METHODE /pfad` wie in OpenAPI |
| `technical.events.emits[]` / `consumes[]` | technisch | Ereignistypen |
| `technical.uiRoutes[]`, `technical.nodeRedNodes[]` | technisch | Seiten der Oberfläche, Node-RED-Nodes |
| `technical.notes[]` | technisch | Tabellen, Fehlercodes, Hinweise |
| `evidence[]` | Nachweis | `scenario` (Szenario-Kennung) oder `unit`/`integration`/`web-e2e` (Datei + Testtitel); `covers[]` nennt die Kriterien, die der Test prüft; `rationale` begründet nach Review einen indirekten Bezug; im Katalog Pflicht |
| `comparisons{}` | Vergleich | je System (z. B. `openwms`) `status` (`gleichwertig`, `erweitert`, `eingeschraenkt`, `neu`, `abweichend`, `nicht-einsehbar`), `note`, `refs`; siehe Abschnitt 7 |
| `state`, `reason` | nur Prüfbestand | `unvollstaendig`, `deaktiviert` oder `nicht-nachgewiesen` und warum |

**Abgeleitet, nicht gepflegt:** Rollen (aus den ändernden Endpunkten eines Features, sonst den lesenden), Bedienwege, Nachweisstatus, aufrufende Tests, Zweck der Endpunkte.

**Nachweisstatus** eines Features in der Ansicht:

| Status | Bedeutung |
|---|---|
| nachgewiesen | jedes Akzeptanzkriterium ist durch einen Test mit Zusicherung belegt, der im letzten Testlauf bestanden hat (nur mit `--reports`) |
| teilweise nachgewiesen | einige Kriterien sind belegt, andere nicht (Test fehlt, schlug fehl, übersprungen oder lief nicht) |
| Nachweis vorhanden | jedes Kriterium hat einen Test mit Zusicherung, Ergebnis unbekannt (ohne Testberichte erzeugt) |
| nicht nachgewiesen | kein Kriterium ist belegt |

### Nachweisregeln

Ein bestandener Test ist noch kein Funktionsnachweis. Deshalb gilt:

1. **Kriterien statt Tests.** Jedes Feature beschreibt in `acceptance` prüfbare Kriterien – mindestens einen beobachtbaren Effekt („Die Zuteilung reserviert die Menge auf den TUs“). Jeder Fehlercode aus `rules` (`CODE` in Backticks) braucht ein Kriterium der Art `regel` mit diesem `code`; Zustandsketten (`` `OPEN` → `DONE` ``) zählen nicht als Codes.
2. **Zuordnung.** Jeder Nachweis nennt in `covers` die Kriterien, die er prüft; jedes Kriterium braucht mindestens einen Nachweis.
3. **Zusicherung.** Der Testkörper (mit den Helfern, die er aufruft) muss etwas zusichern (`expect`, `assert`, Szenario-`check`/`event`). Ein Nachweis ohne Zusicherung trägt kein Kriterium.
4. **Fehlercode im Test.** Der `code` eines Regel-Kriteriums muss als ganzes Wort in einem abdeckenden Test vorkommen – der Test muss die Regel also auslösen und den Code prüfen.
5. **Effekt statt Status.** Sichert ein Test nur Status oder Existenz zu (`status` 201, `toBeTruthy`), oder berührt er keinen Endpunkt, kein Ereignis, keine Seite, keinen Node und keine Komponente des Features, gibt es eine Warnung. Nach Review lässt sich ein indirekter Bezug in `rationale` begründen (z. B. Querschnittsfunktion ohne eigenen Endpunkt) – die Begründung ersetzt die Warnung, nicht den Test.
6. **Belegt ist belegt.** Ein Kriterium ist belegt, wenn mindestens ein zugeordneter Test mit Zusicherung im letzten Testlauf bestanden hat.

Die Heuristik liest den Testkörper statisch; sie erkennt viel, aber nicht alles. Sie ersetzt nicht das Review, sondern zwingt es dorthin, wo ein Test die beschriebene Fähigkeit nicht erkennbar prüft.

## 4. Automatische Prüfungen

| Prüfung | Stufe | Wann |
|---|---|---|
| YAML entspricht dem Datenmodell; Kennungen eindeutig; Gruppen und Abhängigkeiten existieren | Fehler | immer |
| Verweise ins Leere: Endpunkt, Ereignis, Route, Node, Quelldatei, Szenario oder Testtitel gibt es nicht (mehr) | Fehler | immer |
| Bestandteil eines **katalogisierten** Bereichs ist keinem Eintrag und keiner Ausnahme zugeordnet (z. B. neuer Endpunkt) | Fehler | immer |
| Nachweis eines Katalog-Features ist fehlgeschlagen, übersprungen oder lief nicht | Fehler | mit `--reports` (CI-Job „Feature-Katalog“) |
| Kein Kriterium der Art `effekt` (`ACCEPTANCE_MISSING`); Fehlercode einer Regel ohne Regel-Kriterium (`RULE_WITHOUT_ACCEPTANCE`) | Fehler | immer |
| Nachweis ohne `covers` oder mit unbekanntem Kriterium (`EVIDENCE_UNLINKED`); Kriterium ohne gültigen, bestandenen Nachweis (`ACCEPTANCE_UNCOVERED`) | Fehler | immer bzw. mit `--reports` |
| Nachweis ohne Zusicherung (`EVIDENCE_NO_ASSERTION`); Fehlercode eines Kriteriums in keinem abdeckenden Test (`RULE_CODE_NOT_ASSERTED`) | Fehler | immer |
| Nachweis sichert nur Status zu (`EVIDENCE_STATUS_ONLY`) oder berührt keinen Bestandteil des Features (`EVIDENCE_UNRELATED`), ohne `rationale` | Warnung | immer |
| Endpunkt eines Features, den kein Test erkennbar aufruft | Warnung | immer |
| Bestandteil ohne zuständigen Bereich (`owns` fehlt) | Warnung | immer |
| Bereich noch offen: Anzahl nicht zugeordneter Bestandteile | Hinweis | immer |

Die Prüfung **legt nie Features an**. Sie meldet, was zugeordnet werden muss; ob daraus ein neues Feature, eine Erweiterung eines bestehenden, ein Prüfbestand-Eintrag oder eine begründete Ausnahme (`exclusions` in `catalog.yaml`) wird, entscheidet ein Mensch.

**In der CI:** Der Job *verify* prüft statisch (der Katalogtest läuft mit den Unit-Tests, dazu `pnpm catalog:check`) und sichert die JUnit-Berichte der Unit-Tests (API, Node-RED-Nodes, Feature-Katalog) und der Integrationstests. Der Katalog beschreibt sich selbst im Bereich „Feature-Katalog“; seine eigenen Tests sind die Nachweise. Der Job *Feature-Katalog* läuft nach *verify* und *e2e*, holt alle JUnit-Berichte (Unit-, Integrations-, Szenario- und Browser-Tests), prüft jedes Katalog-Feature gegen die Ergebnisse und legt die Ansicht als Artefakt `feature-katalog` ab.

## 5. Pflege

| Anlass | Vorgehen |
|---|---|
| Neuer Endpunkt / neues Ereignis in einem katalogisierten Bereich | CI meldet `UNASSIGNED`. Bestehendem Feature zuordnen, neues Feature anlegen (mit Nachweis) oder in den Prüfbestand bzw. als Ausnahme eintragen. |
| Neues Feature | Eintrag in `features/<bereich>.yaml` mit Akzeptanzkriterien (mindestens ein Effekt, je Fehlercode eine Regel) und Nachweisen mit `covers`; ohne Test zuerst in `review.yaml`. |
| Prüfung meldet `RULE_CODE_NOT_ASSERTED` oder `ACCEPTANCE_UNCOVERED` | Test ergänzen, der die Regel auslöst und den Code bzw. den Effekt zusichert – nicht das Kriterium abschwächen. |
| Warnung `EVIDENCE_STATUS_ONLY`/`EVIDENCE_UNRELATED` | Test lesen: Zusicherung auf den Effekt schärfen; ist der Bezug nur indirekt (Querschnittsfunktion), mit `rationale` begründen. |
| Endpunkt, Test oder Datei umbenannt/entfernt | CI meldet `UNKNOWN_*`. Verweis anpassen oder Eintrag in den Prüfbestand verschieben. |
| Test schlägt fehl | Job *Feature-Katalog* meldet `EVIDENCE_FAILED`; das Feature gilt als nicht nachgewiesen, bis der Test wieder grün ist. |
| Prüfbestand-Eintrag bekommt einen Test | Eintrag mit Nachweis nach `features/<bereich>.yaml` verschieben. |
| Bereich fertig katalogisiert | In `catalog.yaml` `status: katalogisiert` setzen – ab dann sind Lücken Fehler. |

## 6. Stand der Bestandsaufnahme

Alle 17 Bereiche sind katalogisiert (`status: katalogisiert`); jeder erkannte Bestandteil ist einem Feature zugeordnet. Mit den Testberichten aller Testarten (Unit, Integration, Node-RED-Szenarien, MQTT-Sicherheit, Browser) sind **alle 102 Features im Testlauf nachgewiesen; der Prüfbestand ist leer**. Die 102 Features haben **305 Akzeptanzkriterien** (Effekte und Regeln, darunter jeder Fehlercode aus den Regeln); jedes ist durch einen bestandenen Test mit Zusicherung belegt. 56 Nachweise prüfen ihr Feature nur indirekt (Querschnittsfunktionen ohne eigenen Endpunkt, Simulation statt Entscheidung, Node-RED-Flows) und tragen dafür eine Begründung nach Review.

**Nachgeschärft beim Einführen der Nachweisregeln:** Für acht Fehlercodes gab es keinen Test, der sie auslöst und zusichert. Neue bzw. erweiterte Integrationstests decken sie jetzt ab: doppelt gescannte TU beim Verladen (`UNIT_ALREADY_LOADED`), Warenausgang bei reserviertem Bestand, aufgestapelten TUs oder offener Bewegung (`STOCK_RESERVED`, `TU_HAS_CHILDREN`, `TU_IN_USE`), Versandetikett für eine fremde TU (`UNIT_NOT_IN_SHIPMENT`), erledigte Bewegung in einer Gruppe (`MOVEMENT_CLOSED`), erneutes Schließen einer Position (`POSITION_NOT_IN_PROGRESS`) und vollständig reservierter Bestand in der Zuteilung (`NOT_AVAILABLE`).

| Bereich | Features | Erkannte Bestandteile |
|---|---|---|
| Lagerstruktur | 6 | 31 |
| Transporteinheiten | 9 | 33 |
| Strategien und Regeln | 7 | 15 |
| Bestand | 14 | 34 |
| Wareneingang | 5 | 20 |
| Lagerbewegungen | 4 | 21 |
| Transportaufträge | 2 | 19 |
| Materialfluss und Anlagen | 7 | 21 |
| Auslagerung | 5 | 13 |
| Versand | 3 | 12 |
| Dokumente und Druck | 3 | 5 |
| Geschäftspartner | 3 | 7 |
| ERP-Anbindung | 6 | 15 |
| Feature-Katalog | 5 | – |
| Integration und Automatisierung | 7 | 11 |
| Bedienoberfläche | 5 | 2 |
| Sicherheit und Betrieb | 11 | 12 |
| **Summe** | **102** | **271** |

**Festlegungen** (Produktentscheidung nach dem Pilot):

- Eine Funktion, die nur über API oder Node-RED bedienbar ist, ist **nicht** unvollständig; die API ist ein vollwertiger Bedienweg.
- Ein Feature ist eine nutzbare Fähigkeit, kein einzelner Endpunkt.
- Eine Seite der Oberfläche oder ein Endpunkt ohne eigenen Test steht im Prüfbestand, auch wenn die Fachfunktion dahinter nachgewiesen ist.

**Abbau des Prüfbestands:** Die 14 Einträge nach der ersten Bestandsaufnahme wurden mit Tests nachgewiesen und sind jetzt Teil der Features: Lese- und Änderungsendpunkte (Integrationstests), die Seiten Wareneingang, Transport, Materialfluss, Ereignisse, Konto und Benutzer sowie Picks am Scanner (Browser-Tests in `apps/web/e2e/seiten.spec.ts`, `auth.spec.ts`, `scanner.spec.ts`) und die MQTT-Absicherung (`packages/scenario-runner/test/security.test.ts`, läuft mit `pnpm test:e2e` gegen die Umgebung).

**Grenze der Erkennung:** „Aufgerufen in“ erkennt Aufrufe mit Methode und Pfad im Quelltext (auch Template-Ausdrücke und `fetch` ohne Methode). Aufrufe über Hilfsfunktionen wie `post(id, 'issues')` bleiben unsichtbar; deshalb ist das nur eine Warnung. Verbindlich sind die ausdrücklichen Nachweise und ihre Testergebnisse.

## 7. Vergleich mit OpenWMS

Grundlage ist die Analyse der öffentlichen OpenWMS-Repositories (`docs/openwms-analyse.md`). Das System ist in `catalog.yaml` unter `systems` eingetragen, mit `complete: true`: Jedes Feature braucht eine Einstufung, sonst schlägt die Prüfung fehl (`COMPARISON_MISSING`). Neue Features werden so automatisch zum Vergleich gezwungen.

| Einstufung | Bedeutung | Features |
|---|---|---|
| gleichwertig | kann dasselbe | 12 |
| erweitert | kann mehr (z. B. durchgesetzte Platzierungsregeln, die OpenWMS nur speichert) | 17 |
| eingeschränkt | kann weniger | 2 |
| neu | in OpenWMS nicht vorhanden (Regelwerk, Simulation, Node-RED, Szenario-Tests, Outbox-Aufbewahrung, ERP-Bausteine, Feature-Katalog) | 20 |
| abweichend | gleicher Zweck, anderer Ansatz (Programme statt BPMN, MQTT-Outbox statt AMQP, OpenAPI statt HATEOAS) | 6 |
| nicht einsehbar | Gegenstück nur in privaten Teilen (Inventory, Picking, Shipping, Printing, Partner, ERP-Adapter, Oberflächen, Identitätsdienst) | 43 |

**Lücken** (`catalog/comparisons/openwms.yaml`, 11 Einträge) – Fähigkeiten von OpenWMS, die bei uns fehlen:

| Status | Einträge |
|---|---|
| fehlt (1) | Betriebsart/Füllgrad je Bereich |
| teilweise (6) | TU-Reservierung, zeitgesteuerte Abläufe, Metriken und Tracing (Prometheus vorhanden, OpenTelemetry fehlt); aus privaten Teilen: ERP-Adapter (SAP über IDoc vorhanden, Dynamics fehlt), Lageraufgaben, Druck (PDF vorhanden, direkter Druck auf Etikettendrucker fehlt) |
| bewusst weggelassen (4) | Mandanten, BPMN-Workflows, Microservices mit Replikaten, HATEOAS |

Geschlossen seit dem ersten Vergleich: Problemhistorie der Transportaufträge (`transportauftraege.ablauf`), Fehlermeldungen je TU (`transporteinheiten.fehlermeldungen`), Anlagenzustand je Platz (`lagerstruktur.anlagenzustand`), Systemstatus (`materialfluss.systemstatus`), Bewegungsgruppen (`lagerbewegungen.bewegungsgruppen`), Geschäftspartner (`partner.stammdaten`, `partner.lieferadresse`, `partner.lieferant`), Versand (`auslagerung.packen`, `versand.sendungen`, `versand.ladekontrolle`, `versand.warenausgang`) mit Versandpapieren (`dokumente.versandpapiere`); Priorität, Attribute und Sperre am Avis (`wareneingang.avis-steuerung`). Zum Teil: Druck (`dokumente.etiketten`, `dokumente.pickliste`), Metriken (`sicherheit.metriken`).

Jede Lücke nennt den Bereich, in den sie gehören würde, ob sie im öffentlichen Code belegt oder nur beschrieben ist (`source: oss | privat`), Belege und verwandte Features. Die Ansicht zeigt den Vergleich im Reiter **Vergleich** (Übersicht, Tabelle je Bereich, Lücken) und je Feature als Abzeichen und Abschnitt; im Katalog lässt sich nach Einstufung filtern.

**Pflege:** Neues Feature → Einstufung ergänzen (die Prüfung verlangt sie). Lücke geschlossen → Eintrag aus `comparisons/openwms.yaml` entfernen und die Einstufung des neuen bzw. erweiterten Features anpassen. Ein weiteres Vergleichssystem → Eintrag unter `systems`, Einstufungen unter `comparisons.<id>`, Lücken in `comparisons/<id>.yaml`.

