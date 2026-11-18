---
name: feature-katalog-python-java
description: Baut und pflegt einen geprüften Feature-Katalog für Applikationen in Python (FastAPI, Django/DRF, Flask) oder Java mit Spring Boot (auch Microservice-Landschaften wie OpenWMS) – YAML als einzige Quelle, Abgleich mit Code und JUnit-Testberichten (pytest, Surefire, Failsafe), interaktive HTML-Ansicht, CI-Prüfung. Verwenden, wenn in einem solchen Projekt ein Feature-Katalog angelegt, erweitert oder geprüft werden soll.
---

# Feature-Katalog für Python- und Spring-Boot-Applikationen

Diese Anleitung beschreibt, wie du (ein LLM-Agent mit Zugriff auf das Repository) für eine Applikation in **Python**
oder **Java/Spring Boot** einen **Feature-Katalog** aufbaust: eine geprüfte Übersicht aller Funktionen, die zeigt, was
die Applikation kann – fachlich für das Produktteam, technisch für die Entwicklung. Sie beruht auf einem fertigen
Katalog (100 Features, 17 Bereiche, alle per Test nachgewiesen) und überträgt dessen Regeln auf diese Stacks.

Schreibe Katalogtexte und Antworten in der Sprache des Projekts bzw. des Nutzers.

---

## 1. Grundsätze (gelten unverändert)

1. **Eine Quelle der Wahrheit:** YAML unter `catalog/` im Repository. Ansicht, JSON und Statistik werden erzeugt.
2. **Nur funktional Nachgewiesenes im Katalog:** Jedes Feature hat prüfbare **Akzeptanzkriterien**, und jedes
   Kriterium hat einen Test, der die Fähigkeit auslöst, den erwarteten Effekt oder die Regel zusichert und im letzten
   CI-Lauf **bestanden** hat (Abschnitt 3.3). Ein bloß grüner Test genügt nicht. Der Rest steht im **Prüfbestand**.
3. **Die Prüfung legt nie selbst Features an** – sie meldet nur (Unzugeordnetes, tote Verweise, fehlende Nachweise).
4. **Die Applikation bleibt unverändert:** keine Annotationen, keine Abhängigkeit im Produktivcode. Das Werkzeug liest
   Code, API-Beschreibung und Testberichte. Erlaubt sind **Tests**, die Informationen aus der laufenden App
   exportieren (z. B. OpenAPI-Datei, Liste aller Request-Mappings).
5. **Nichts abschreiben, was sich ableiten lässt** (Rollen, Endpunkt-Beschreibungen, Testergebnisse, aufrufende Tests).
6. **Zwei Ebenen je Feature:** fachlich und technisch (in der Ansicht aufklappbar).
7. **Zuschnitt:** ein Feature = eine nutzbare Fähigkeit, nicht ein Endpunkt, nicht ein Modul.
8. **Nur über API oder Messaging bedienbar ist nicht „unvollständig“** – jeder Bedienweg zählt.

---

## 2. Vorgehen

Abstimmen mit dem Nutzer bei ★.

| Phase | Inhalt |
|---|---|
| 0 ★ | Rückfragen mit Vorschlag: Zielgruppe, Bedienwege (z. B. `web`, `api`, `messaging`, `batch`, `entwicklung`), Rollen, Testarten als Nachweis, Vergleichssystem, **ein Repository oder mehrere Dienste** |
| 1 | Analyse: welche Bestandteile sich automatisch erkennen lassen (Abschnitt 4), was nicht (Zuschnitt, Nutzen, Regeln) |
| 2 ★ | Taxonomie: Bereich → Gruppe → Feature; Bereiche fachlich, `owns` über Präfixe |
| 3 | Werkzeug bauen (Abschnitt 5), Testberichte in der CI erzeugen (Abschnitt 6) |
| 4 ★ | Pilot: einen Bereich vollständig katalogisieren, Ansicht zeigen, Zuschnitt bestätigen lassen |
| 5 | Alle Bereiche; fehlende Tests schreiben oder Prüfbestand; Bereich auf `katalogisiert` |
| 6 | CI-Job mit allen Berichten, Ansicht als Artefakt, `docs/feature-katalog.md` |

---

## 3. Dateien und Datenmodell (sprachunabhängig)

```
catalog/
  catalog.yaml                 # Bereiche, Gruppen, owns, Vergleichssysteme, Ausnahmen
  features/<bereich>.yaml      # Features
  review.yaml                  # Prüfbestand (gleiches Format + state, reason)
  comparisons/<system>.yaml    # optional: Lücken gegenüber einem Vergleichssystem
docs/feature-katalog.md
```

### 3.1 `catalog/catalog.yaml`

```yaml
schemaVersion: 1
services:                     # nur bei mehreren Diensten/Repositories (sonst weglassen)
  - id: receiving
    title: wms-receiving
areas:
  - id: wareneingang
    title: Wareneingang
    summary: Avisierte und nicht avisierte Ware erfassen.
    status: katalogisiert     # oder: offen
    owns:
      endpoints: ["receiving:/v1/receiving-orders", "receiving:/v1/capture"]   # [dienst:]pfad-präfix
      events: ["receiving.event.ro"]        # Ereignis-/Routing-Key-Präfixe
      jobs: ["receiving:cleanupOrders"]     # @Scheduled, Celery-Tasks …
      commands: []                          # CLI/Management-Commands
      uiRoutes: []
    groups:
      - id: wareneingang.avis
        title: Avis und Auftrag
        summary: Erwartete Lieferungen und ihr Abschluss.
exclusions:
  endpoints:
    - { item: "GET /actuator/health", reason: Betriebsendpunkt, kein Feature }
```

Präfix-Regel: `/v1/receiving-orders` passt auf sich selbst und `/v1/receiving-orders/…`, **nicht** auf
`/v1/receiving-orders-export`.

### 3.2 Feature

```yaml
area: wareneingang
features:
  - id: wareneingang.avis-anlegen
    title: Avis anlegen
    group: wareneingang.avis
    summary: Erfasst eine erwartete Lieferung mit Positionen je Produkt oder Transporteinheit.
    description: |
      Fachliche Beschreibung ohne Code-Begriffe.
    usage:
      - channel: api
        text: "`POST /v1/receiving-orders` mit Positionen; Antwort mit Link auf den Auftrag."
      - channel: messaging
        text: "Ereignis `receiving.event.ro.created` auf Exchange `receiving`."
    rules:
      - Auftragsnummer eindeutig (`409`).
    dependsOn: []
    technical:
      service: receiving                        # bei mehreren Diensten
      components:
        - src/main/java/org/example/receiving/ReceivingController.java     # bzw. app/receiving/views.py
      endpoints: ["POST /v1/receiving-orders", "GET /v1/receiving-orders/{pKey}"]
      events: { emits: [receiving.event.ro.created], consumes: [] }
      jobs: []
      notes: [Tabelle `WMS_REC_ORDER`.]
    acceptance:                                        # Pflicht, siehe 3.3
      - id: auftrag-angelegt
        kind: effekt
        text: Ein Avis mit zwei Positionen ist danach mit Zustand CREATED und beiden Positionen lesbar.
      - id: nummer-eindeutig
        kind: regel
        text: Eine bereits vergebene Auftragsnummer wird abgelehnt.
        code: "409"                                    # HTTP-Status, Fehlercode oder Exception-Klasse
    evidence:
      - kind: integration
        file: src/test/java/org/example/receiving/ReceivingOrderControllerIT.java
        test: shall create order with positions        # @DisplayName oder Methodenname
        covers: [auftrag-angelegt]
      - kind: integration
        file: src/test/java/org/example/receiving/ReceivingOrderControllerIT.java
        test: shall reject duplicate order id
        covers: [nummer-eindeutig]
      - kind: unit
        file: tests/unit/test_rsvp.py                  # Python-Projekt: gleiches Prinzip
        test: test_saves_rsvp_with_plus_one            # Funktionsname, optional Klasse::funktion
        covers: [zusage-mit-begleitung]
    comparisons: {}                                    # nur mit Vergleichssystem
```

Prüfbestand: gleiches Format plus `state` (`unvollstaendig`, `deaktiviert`, `nicht-nachgewiesen`) und `reason`.

### 3.3 Nachweisregeln: Test ≠ Funktionsnachweis

Ein bestandener Test ist **nicht automatisch ein Funktionsnachweis**: Er kann nur den HTTP-Status prüfen, etwas
Benachbartes testen oder das Ergebnis selbst herstellen (Mocks). Deshalb gelten diese verbindlichen Nachweisregeln.

**Akzeptanzkriterien:** Jedes Feature nennt prüfbare Kriterien – die Brücke zwischen Beschreibung und Test.

```yaml
    acceptance:
      - id: zusage-mit-begleitung
        kind: effekt          # effekt = die Fähigkeit wirkt, mit beobachtbarem Ergebnis
        text: Eine Zusage mit Begleitung wird gespeichert; die Gästeliste zählt danach zwei Personen.
      - id: anmeldeschluss
        kind: regel           # regel = fachliche Regel bzw. Grenze
        text: Nach dem Anmeldeschluss lehnt das System Änderungen durch Gäste ab.
        code: RSVP_CLOSED     # Fehlercode/Exception, falls vorhanden
    evidence:
      - kind: integration
        file: tests/integration/test_rsvp.py
        test: test_saves_rsvp_with_plus_one_and_counts_two
        covers: [zusage-mit-begleitung]
      - kind: integration
        file: tests/integration/test_rsvp.py
        test: test_rejects_changes_after_deadline
        covers: [anmeldeschluss]
```

| Nr. | Regel |
|---|---|
| N1 | Jedes Katalog-Feature hat mindestens ein Kriterium der Art **effekt**. Jede Regel mit Fehlercode aus `rules` erscheint als Kriterium der Art **regel**. |
| N2 | Jeder Nachweis nennt unter `covers`, welche Kriterien er prüft. Ein Nachweis ohne `covers` zählt nicht. |
| N3 | Ein Feature ist erst **nachgewiesen**, wenn **jedes** Kriterium mindestens einen Nachweis hat, der im letzten Lauf bestanden hat. Sonst gilt es als *teilweise nachgewiesen* und gehört in den Prüfbestand. |
| N4 | Der Test **wirkt und prüft**: Er löst die Fähigkeit über einen Bestandteil des Features aus (Endpunkt, Seite, Ereignis, Komponente) und sichert mindestens einen **erwarteten Effekt** (fachlicher Wert, gespeicherter Zustand, ausgelöstes Ereignis, angezeigte Information) oder die **Regel** (abgelehnte Aktion mit Fehlercode) zu. Statuscode, „nicht null“ oder „Seite lädt“ allein genügen nicht. |
| N5 | Der Effekt wird **von außen beobachtet** – über die Antwort, eine Lese-Schnittstelle, ein Ereignis oder die Oberfläche –, nicht nur über Aufrufe an Mocks des eigenen Codes. Rein mock-basierte Unit-Tests zählen nur für Kriterien reiner Berechnungs- oder Entscheidungslogik. |
| N6 | Bei Kriterien der Art regel mit `code` steht der Fehlercode im Test als Zusicherung. |
| N7 | **Review-Pflicht:** Wer einen Nachweis einträgt oder ändert, liest den Testcode und bestätigt die Zuordnung. Als LLM-Agent gibst du im PR je neuem Nachweis eine Zeile an: *Kriterium → auslösende Aktion → Zusicherung (Datei:Zeile)*. Änderungen unter `catalog/features/` sind per CODEOWNERS reviewpflichtig. |
| N8 | **Kein Nachweis** sind: Smoke-Tests (Endpunkt antwortet, Seite lädt), Snapshot-Tests ohne fachliche Zusicherung, übersprungene Tests, Tests, die nur prüfen, was sie selbst gemockt haben. |
| N9 | Optional, aber empfohlen für Kernfunktionen: **Mutationstests** (Stryker für JS/TS, PIT für Java, mutmut für Python) auf den Komponenten des Features. Überlebende Mutanten in abgedeckten Pfaden zeigen zu schwache Zusicherungen. |

**Statische Prüfung des Testkörpers** (Heuristik, ergänzt das Review, ersetzt es nicht): Den Körper des Tests
ermitteln (JS/TS: Block nach dem Testtitel per Klammerzählung; Java: Methodenkörper per JavaParser; Python:
Funktionskörper per `ast`) und darin prüfen:

- **Zusicherungen vorhanden:** `expect`/`assert`/`assertThat`/`assertEquals`/`andExpect`/`verify`/`pytest.raises`/
  `assert` …
- **Nicht nur Status:** Gibt es nur Zusicherungen auf Statuscode, `isOk()`, `toBeTruthy()`, `is not None`, gilt das als
  reine Statusprüfung.
- **Bezug zum Feature:** Der Körper (samt aufgerufener Test-Helfer derselben Datei) nennt einen Endpunkt, eine
  Komponente, ein Ereignis oder eine Seite des Features.
- **Fehlercode:** Bei Regel-Kriterien mit `code` kommt der Code im Körper vor.

Stack-spezifische Zusicherungen für die statische Prüfung:

| | Zusicherung | nur Status (→ `EVIDENCE_STATUS_ONLY`) |
|---|---|---|
| Java | `assertThat`, `assertEquals`, `assertThrows`, MockMvc `andExpect(jsonPath(…))`, RestAssured `.body(…)`, `verify` | nur `andExpect(status().isOk())`, `.statusCode(200)`, `assertNotNull` |
| Python | `assert`, `pytest.raises`, `self.assertEqual`, `assertContains` | nur `assert response.status_code == 200`, `assert x is not None` |

---

## 4. Erkennung je Stack

**Grundregel:** Bestandteile möglichst aus einer **eingecheckten, per Test aktuell gehaltenen Exportdatei** lesen
(z. B. `catalog/discovered/openapi-<dienst>.json`, `mappings-<dienst>.json`). Ein Test erzeugt die Datei aus der
laufenden App und schlägt fehl, wenn sie veraltet ist (mit Schalter zum Neuschreiben, z. B. `UPDATE_SNAPSHOTS=1`).
So bleibt das Werkzeug unabhängig von Framework-Interna, und die App wird nicht verändert.

### 4.1 Java / Spring Boot

| Bestandteil | Erkennung (bevorzugt → Ausweichweg) |
|---|---|
| HTTP-Endpunkte | **springdoc-openapi:** `@SpringBootTest` ruft `/v3/api-docs` auf und schreibt die Datei → **`RequestMappingHandlerMapping`** im Test: alle `RequestMappingInfo` (Methoden, Pfade, Controller-Klasse/Methode) als JSON exportieren → statisch mit **JavaParser**: `@RequestMapping`/`@GetMapping`/… inkl. Klassen-Präfix und **Konstanten** (`API_RECEIVING_ORDERS`) auflösen |
| Spring HATEOAS | Index-/Link-Endpunkte als eigene Bestandteile oder begründete Ausnahme; Links sind keine Endpunkte |
| Ereignisse (intern) | Klassen, die per `ApplicationEventPublisher.publishEvent(...)` veröffentlicht werden; `@EventListener`, `@TransactionalEventListener` (JavaParser oder ClassGraph im Test) |
| Messaging (AMQP/Kafka) | `@RabbitListener(queues/bindings)`, `RabbitTemplate.convertAndSend(exchange, routingKey, …)`, `@KafkaListener(topics)`, Spring Cloud Stream `spring.cloud.stream.bindings.*` in `application.yml`; Bestandteil = Exchange + Routing-Key bzw. Topic |
| Jobs | `@Scheduled`, Quartz-Jobs, Spring Batch `Job`-Beans |
| Rechte | `@PreAuthorize`/`@Secured`/`@RolesAllowed` an Controller-Methoden (statisch); `SecurityFilterChain` mit `requestMatchers(...).hasRole(...)` → am verlässlichsten per Test: für jeden Endpunkt prüfen, welche Rollen Zugriff haben, und als Tabelle exportieren |
| Oberfläche | Thymeleaf-Controller (`@Controller` mit View-Namen) oder getrenntes Frontend (dann dessen Routen) |
| Konfiguration | `@ConfigurationProperties`-Klassen → Kandidaten für `settings` eines Features |

**Testberichte:** Maven Surefire (`target/surefire-reports/TEST-*.xml`, Unit) und Failsafe
(`target/failsafe-reports/TEST-*.xml`, `*IT`), Gradle `build/test-results/<task>/TEST-*.xml`. In JUnit-XML ist
`classname` der voll qualifizierte Klassenname, `name` der Methodenname bzw. `@DisplayName`, bei
`@ParameterizedTest` mit `[1] …`-Zusatz. Nachweis-Zuordnung: Klassenname aus `file` ableiten (Pfad unter
`src/test/java` → Paket.Klasse) und `test` gegen `name` vergleichen (exakt, ohne Parameter-Zusatz, oder
`@Nested`-Pfad). Cucumber/JBehave liefern eigene JUnit-Berichte → Nachweisart `scenario` (Feature-Datei + Szenario-Name).

**Statische Existenzprüfung eines Tests:** `@DisplayName("…")`-Literal oder Methodenname `void <name>(` in der Datei.

**Welcher Test ruft welchen Endpunkt (Heuristik, nur Warnung):**
- MockMvc: `perform(get("/v1/…"))`, `post(API_X + "/{id}", id)`; RestAssured: `.when().post("/v1/…")`;
  WebTestClient: `.post().uri("/v1/…")`; `TestRestTemplate.postForEntity("/v1/…")`.
- Konstanten auflösen (Paket-weite `static final String`), sonst bleibt der Aufruf unsichtbar.
- **Spring REST Docs** (bei OpenWMS verbreitet) sind die beste Quelle: Die Tests erzeugen
  `target/generated-snippets/<name>/http-request.adoc` mit Methode und Pfad – daraus „aufgerufen von Test X“ ableiten.
- Ein Pfad zählt nur mit unmittelbar davor stehender Methode (`get|post|put|patch|delete`), sonst würden reine
  Pfadlisten als Aufruf gelten.

### 4.2 Python

| Bestandteil | FastAPI | Django / DRF | Flask |
|---|---|---|---|
| HTTP-Endpunkte | Test schreibt `app.openapi()` als JSON; oder `app.routes` (Methoden, Pfad, Endpunktfunktion) | `get_resolver().url_patterns` rekursiv (Pfad, Name, View) bzw. `manage.py spectacular`/`generateschema` | `app.url_map.iter_rules()` (Methoden, Regel, Endpoint) |
| Rechte | `Depends`/`Security(scopes=…)` je Route (Test: `route.dependant`) | `permission_classes`, `@permission_required`, DRF-ViewSets | Dekoratoren (`@login_required`, eigene) statisch mit `ast` |
| Seiten | Templates via `TemplateResponse` | URL-Namen mit Template-Views | `render_template`-Views |

Weitere Bestandteile: **Celery-Tasks** (`@shared_task`, `app.tasks` im Test auflisten; Beat-Zeitplan),
**Django-Signals** und eigene Ereignisse (zentrale Registrierung bevorzugen), **Kafka/RabbitMQ**-Topics,
**Management-Commands** (`django.core.management.get_commands()`), **CLI** (click/typer-Gruppen), **Pydantic-Settings**
als Kandidaten für `settings`.

**Testberichte:** `pytest --junitxml=reports/unit-junit.xml` (je Testart eigene Datei, z. B. per Marker
`-m integration`). In pytest-JUnit ist `classname` der Modulpfad mit Punkten plus ggf. Klasse
(`tests.integration.test_rsvp.TestRsvp`), `name` der Funktionsname, bei Parametrisierung `name[param]`. Zuordnung:
Modulpfad aus `file`, `test` = Funktionsname oder `Klasse::funktion`. pytest-bdd/behave → Nachweisart `scenario`,
Playwright für Python → `e2e`.

**Statische Existenzprüfung:** mit `ast` nach `def <name>` (bzw. `async def`) in der Datei suchen, nicht per Textsuche.

**Testaufrufe (Heuristik, nur Warnung):** `client.post("/api/…")`, `client.get(f"/api/guests/{guest.id}")`
(f-String-Ausdrücke als Parameter zulassen), Django `reverse("guest-rsvp", …)` → über die exportierte
URL-Namen-Tabelle in einen Pfad übersetzen; `httpx`/`requests` gegen eine Test-URL.

### 4.3 Mehrere Dienste / Repositories (z. B. OpenWMS)

- **Ein Katalog je Landschaft, nicht je Dienst:** Ein eigenes Repository (oder ein Ordner im zentralen Repo) hält
  `catalog/`. Jeder Dienst liefert in seiner CI ein **Artefakt** mit Exportdateien (OpenAPI, Mappings, Ereignisse) und
  JUnit-Berichten; der Katalog-Job sammelt die Artefakte der jeweils neuesten Hauptzweig-Läufe ein.
- Bestandteile werden mit dem Dienst qualifiziert (`receiving:POST /v1/receiving-orders`), damit gleiche Pfade in
  verschiedenen Diensten unterscheidbar bleiben.
- Ein Feature darf mehrere Dienste umfassen (z. B. Wareneingang bucht Bestand im Inventory-Dienst) – `technical.service`
  ist dann eine Liste.
- **Private oder nicht zugängliche Dienste:** nicht raten. Bereich auf `offen` lassen bzw. Features mit Einstufung
  `nicht-einsehbar` nur im Vergleich führen; Lücken mit `source: privat` kennzeichnen.
- Ereignisse sind bei AMQP meist Routing-Keys (`receiving.event.ro.created`); `owns.events` per Präfix bis zum Punkt.

---

## 5. Werkzeug bauen

Klein halten (Größenordnung 1500–2500 Zeilen inkl. Ansicht). **Nicht** in die ausgelieferte Applikation einbauen.

| | Python-Projekt | Spring-Boot-Projekt |
|---|---|---|
| Ort | `tools/feature_catalog/` (eigenes Paket, Dev-Abhängigkeit) | eigenes Maven-/Gradle-Modul `feature-catalog` (nicht im Boot-JAR) **oder** dasselbe Python-Werkzeug, wenn das Team Python ohnehin nutzt |
| Schema | Pydantic v2 mit `model_config = ConfigDict(extra="forbid")` | Java-Records + Jackson (`FAIL_ON_UNKNOWN_PROPERTIES`) + Bean Validation, oder JSON-Schema |
| YAML | `ruamel.yaml` (Round-Trip, Kommentare bleiben) | `jackson-dataformat-yaml` (lesen); Schreibvorgänge vermeiden – der Katalog wird von Hand gepflegt |
| Code-Analyse | `ast` | JavaParser (Apache-2.0/LGPL – Lizenz prüfen), ClassGraph im Test |
| CLI | `python -m feature_catalog check|build [--reports DIR] [--out DIR]` | `mvn -pl feature-catalog exec:java -Dexec.args="check --reports …"` bzw. Gradle-Task |
| Ansicht | eine HTML-Datei mit eingebetteten Daten; Vorlage per `string.Template` oder Jinja2 | eine HTML-Datei; Vorlage als Ressource, Daten als JSON eingebettet |
| Tests | pytest | JUnit 5 |

Bestandteile des Werkzeugs: **Schema** · **Erkennung** (liest die Exportdateien/Code) · **Analyse** (Regeln aus 5.1) ·
**JUnit-Leser** · **Ansicht-Generator** · **CLI**. Vor jeder neuen Abhängigkeit Lizenz und Alter der Version prüfen.

### 5.1 Prüfregeln

| Code | Stufe | Wann |
|---|---|---|
| `SCHEMA` | Fehler | YAML ungültig oder Schema verletzt |
| `UNASSIGNED` | Fehler (katalogisiert) / Hinweis (offen) | erkannter Bestandteil ohne Feature, Prüfbestand oder Ausnahme |
| `UNOWNED` | Fehler | Bestandteil, den kein Bereich beansprucht |
| `UNKNOWN_ENDPOINT` / `UNKNOWN_EVENT` / `UNKNOWN_JOB` | Fehler | Verweis auf Entferntes |
| `UNKNOWN_COMPONENT` | Fehler | Quelldatei fehlt |
| `UNKNOWN_TEST` | Fehler | Testmethode/-funktion bzw. `@DisplayName` nicht (mehr) in der Datei |
| `UNKNOWN_DEPENDENCY` | Fehler | `dependsOn` ins Leere |
| `EVIDENCE_MISSING` | Fehler | Katalog-Feature ohne Nachweis |
| `ACCEPTANCE_MISSING` | Fehler | Katalog-Feature ohne Kriterium der Art effekt (N1) |
| `RULE_WITHOUT_ACCEPTANCE` | Fehler | Fehlercode in `rules` ohne Kriterium der Art regel (N1) |
| `EVIDENCE_UNLINKED` | Fehler | Nachweis ohne `covers` oder mit unbekannter Kriteriums-ID (N2) |
| `ACCEPTANCE_UNCOVERED` | Fehler | Kriterium ohne Nachweis bzw. ohne bestandenen Nachweis (N3) |
| `EVIDENCE_NO_ASSERTION` | Fehler | Testkörper ohne Zusicherung (N4) |
| `RULE_CODE_NOT_ASSERTED` | Fehler | Regel-Kriterium mit `code`, kein abdeckender Test enthält den Code (N6) |
| `EVIDENCE_STATUS_ONLY` | Warnung | Testkörper sichert nur Status/Existenz zu (N4) – Review nötig |
| `EVIDENCE_UNRELATED` | Warnung | Testkörper berührt keinen Bestandteil des Features (N4) – Review nötig |
| `EVIDENCE_FAILED` | Fehler | im Testlauf fehlgeschlagen (`failure`/`error`) |
| `EVIDENCE_SKIPPED` | Fehler | übersprungen (`skipped`, `@Disabled`, `pytest.skip`, fehlende Testcontainers-Umgebung) – **zählt nie als bestanden** |
| `EVIDENCE_NOT_RUN` | Fehler | Testart lief, Nachweis kam nicht vor |
| `COMPARISON_MISSING` | Fehler | Vergleichssystem mit `complete: true`, Feature ohne Einstufung |
| `ENDPOINT_UNTESTED` | **Warnung** | kein Test ruft einen Endpunkt erkennbar auf (Heuristik) |

Welche Testart ein Bericht abdeckt, am Inhalt erkennen (Surefire vs. Failsafe/`*IT`, Marker, Verzeichnis), nicht am
Dateinamen. Ohne `--reports` nur statisch prüfen und das in der Ausgabe sagen.

### 5.2 Ansicht

Eine eigenständige HTML-Datei (kein Server, keine externen Skripte) plus `catalog.json`: Kennzahlen, Navigation
Bereich → Gruppe, Reiter Katalog/Prüfbestand/Vergleich, Suche, Filter (Rolle, Bedienweg, Dienst, Nachweisstatus,
Einstufung), Feature-Karte mit fachlicher Ebene und aufklappbaren technischen Details (Endpunkte mit Zweck und Rollen,
Ereignisse, Jobs, Nachweise mit Ergebnis, aufrufende Tests), hell/dunkel, mobil lesbar.

---

## 6. CI

**Spring Boot (GitHub Actions, Maven):**

```yaml
- run: ./mvnw -B verify            # Surefire + Failsafe, Export-Tests schreiben/prüfen Snapshots
- uses: actions/upload-artifact@v4
  with:
    name: junit
    path: |
      **/target/surefire-reports/TEST-*.xml
      **/target/failsafe-reports/TEST-*.xml
      **/target/generated-snippets/**
- run: ./mvnw -B -pl feature-catalog exec:java -Dexec.args="check --reports reports"
```

**Python:**

```yaml
- run: pytest -m "not integration" --junitxml=reports/unit-junit.xml
- run: pytest -m integration --junitxml=reports/integration-junit.xml
- run: pytest tools/feature_catalog/tests --junitxml=reports/catalog-unit-junit.xml
- run: python -m feature_catalog check --reports reports
- run: python -m feature_catalog build --reports reports --out catalog/dist
- uses: actions/upload-artifact@v4
  with: { name: feature-katalog, path: catalog/dist }
```

E2E-/Szenario-Tests laufen in eigenen Jobs; der Katalog-Job hängt von allen ab und lädt alle Berichte herunter.
Auch die **Tests des Katalog-Werkzeugs** liefern einen Bericht – sie sind Nachweise für den Bereich `katalog`.

---

## 7. Der Katalog beschreibt sich selbst

Bereich `katalog` (ohne `owns`, Bedienweg `entwicklung`) mit den Features Datenmodell, Abgleich mit dem Code,
Nachweise im Testlauf, Ansicht und ggf. Vergleich. Nachweise sind die Tests des Werkzeugs, mindestens:
„hat keine Fehler“ (echter Katalog besteht), „ordnet jeden erkannten Bestandteil einem Bereich zu“, „erzeugt eine
eigenständige Ansicht“, „verlangt mindestens einen Nachweis“, „legt nie selbst Features an“, „meldet Verweise auf
Entferntes“, „kennzeichnet fehlgeschlagene, übersprungene und fehlende Nachweise“, „erkennt Aufrufe mit Methode, nicht
aber bloße Pfadlisten“, „verlangt für jedes Akzeptanzkriterium einen bestandenen Nachweis“, „erkennt Nachweise ohne
Zusicherung, mit reiner Statusprüfung oder ohne Bezug zum Feature“, „verlangt den Fehlercode einer Regel als Zusicherung“.

---

## 8. Pflege, Fallstricke, Abnahme

**Pflege:** neue Funktion → Feature mit Nachweis; neuer Endpunkt → zuordnen oder begründete Ausnahme; Test umbenannt →
Nachweis anpassen (`UNKNOWN_TEST`); Funktion entfernt → Feature löschen, ID nie wiederverwenden; ohne Test →
Prüfbestand mit Grund; Bereich fertig → `status: katalogisiert`.

**Fallstricke:**
- **Grüner Test ≠ Funktion:** erst Akzeptanzkriterien, dann passende Tests auswählen oder schreiben; lieber ein
  Kriterium offen im Prüfbestand als ein Scheinnachweis. Neue Nachweise im PR mit „Kriterium → Aktion → Zusicherung
  (Datei:Zeile)“ belegen.
- **`@DisplayName` bevorzugen** (Java) bzw. sprechende Funktionsnamen (Python): Testnamen sind die Brücke zum Katalog.
- **Parametrisierte Tests:** Nachweis ohne Parameter-Zusatz angeben; alle Instanzen müssen bestanden haben.
- **`@Disabled`/`skip` und fehlende Docker-Umgebung** (Testcontainers) führen zu `skipped` – das ist kein Nachweis.
- **Pfad-Konstanten** (`API_ORDERS + "/{pKey}"`) und `reverse()`-Namen auflösen, sonst bleibt die Aufruf-Erkennung blind.
- **Veraltete lokale Berichte** (`target/` vom letzten Mal) erzeugen `EVIDENCE_NOT_RUN` – vor dem Prüfen frisch bauen.
- **Kontextpfad und Versionspräfix** (`server.servlet.context-path`, `/api/v1`) einheitlich normalisieren.
- **Actuator, Swagger-UI, Admin** als begründete Ausnahmen führen, nicht als Features.
- **YAML:** Werte mit Doppelpunkt in Anführungszeichen; mehrzeilig mit `|`; beim maschinellen Ändern Round-Trip.
- Nur erfundene Beispieldaten in Texten und Tests.

**Abnahme:**
- [ ] `check` ohne Fehler, Warnungen begründet.
- [ ] Alle Bereiche `katalogisiert`, jeder Bestandteil zugeordnet oder begründet ausgenommen.
- [ ] Jedes Feature hat Akzeptanzkriterien (mindestens ein Effekt, jede Regel mit Fehlercode).
- [ ] Jedes Kriterium hat einen Nachweis, der die Fähigkeit auslöst, Effekt bzw. Regel zusichert und im letzten
      CI-Lauf bestanden hat; Warnungen zu Statusprüfung oder fehlendem Bezug sind per Review geklärt.
- [ ] Prüfbestand leer oder jeder Eintrag mit Grund.
- [ ] Ansicht als CI-Artefakt mit Suche, Filtern, Navigation, aufklappbarer Technik.
- [ ] Bereich `katalog` beschreibt das Werkzeug.
- [ ] `docs/feature-katalog.md` mit Aufbau, Regeln, Pflege und Stand.
- [ ] Produktivcode unverändert (neu sind nur Tests, Werkzeug, CI, Doku, Exportdateien).
