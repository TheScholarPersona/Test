---
name: feature-katalog
description: Baut und pflegt einen geprüften Feature-Katalog für eine Applikation – YAML als einzige Quelle, automatischer Abgleich mit Code und Testergebnissen, interaktive HTML-Ansicht, CI-Prüfung. Verwenden, wenn ein Feature-Katalog angelegt, erweitert oder geprüft werden soll oder gefragt wird, was die Applikation alles kann.
---

# Feature-Katalog für eine Applikation aufbauen

Diese Anleitung beschreibt, wie du (ein LLM-Agent mit Zugriff auf das Repository) für eine Applikation einen
**Feature-Katalog** aufbaust: eine strukturierte, geprüfte Übersicht aller Funktionen – wie ein Ikea-Katalog, der zeigt,
was die Applikation schon alles kann. Sie stammt aus einem fertigen Katalog (WMS mit 100 Features, 17 Bereichen) und
ist technologieneutral formuliert. Passe Werkzeuge und Erkennung an den Stack des Zielprojekts an.

Antworte und schreibe Katalogtexte in der Sprache des Projekts bzw. des Nutzers.

---

## 1. Ziel und Grundsätze (nicht verhandelbar)

1. **Eine Quelle der Wahrheit:** Der Katalog liegt als YAML im Repository (`catalog/`). Alles andere (Ansicht, JSON,
   Statistiken) wird daraus erzeugt.
2. **Nur Nachgewiesenes steht im Katalog.** Ein Feature braucht mindestens einen automatisierten Test als Nachweis.
   Was (noch) nicht nachgewiesen ist, steht im **Prüfbestand** (`catalog/review.yaml`), nicht im Katalog.
3. **Die Prüfung legt nie selbst Features an.** Sie meldet nur: nicht zugeordnete Bestandteile, tote Verweise,
   fehlende oder fehlgeschlagene Nachweise. Neue Features schreibt immer ein Mensch oder du – bewusst, mit Zuschnitt
   und Beschreibung.
4. **Die Applikation ändert sich durch den Katalog nicht.** Das Katalog-Werkzeug liest nur (Code, API-Beschreibung,
   Testberichte). Keine Annotationen im Produktivcode, keine Laufzeitabhängigkeit.
5. **Was sich aus dem Code ableiten lässt, wird nicht abgeschrieben**, sondern beim Prüfen ergänzt (Rollen,
   Endpunkt-Beschreibungen, Testergebnisse, aufrufende Tests).
6. **Zwei Ebenen je Feature:** fachlich (für Produktteam und Fachanwender) und technisch (für Entwickler,
   in der Ansicht aufklappbar).
7. **Zuschnitt:** Ein Feature ist **eine nutzbare Fähigkeit** („Gäste einladen und Zusagen erfassen“), nicht ein
   einzelner Endpunkt und nicht ein ganzes Modul. Es bündelt die dafür nötigen Endpunkte, Seiten, Ereignisse usw.
   Mehrere Features dürfen denselben Bestandteil nennen.
8. **Eine Funktion, die nur über API oder Automatisierung bedienbar ist, ist nicht „unvollständig“** – jeder
   Bedienweg zählt.

---

## 2. Vorgehen

Arbeite in diesen Phasen und stimme die mit ★ markierten Entscheidungen mit dem Nutzer ab, bevor du baust.

### Phase 0 – Rückfragen ★

Kläre kurz (mit Vorschlag, nicht offen):

- **Zielgruppe** der Ansicht (Entwickler, Produktteam, Kunden?) – bestimmt Ton der fachlichen Texte.
- **Bedienwege** der Applikation (z. B. `web`, `mobil`, `api`, `admin`, `automatisierung`, `entwicklung` für CLI/CI).
- **Rollen**, falls es eine Rechteverwaltung gibt (werden möglichst aus dem Code abgeleitet).
- **Vergleichssystem** (optional): Soll gegen ein anderes Produkt verglichen werden (Wettbewerber, Vorgängersystem)?
- **Testarten**, die als Nachweis zählen (Unit, Integration, End-to-End/Browser, sonstige Szenarien).

### Phase 1 – Analyse: Woraus lassen sich Fähigkeiten automatisch erkennen?

Untersuche das Repository und lege eine Tabelle an: *Quelle → was erkannt wird → Verlässlichkeit*. Typische Quellen:

| Stack-Merkmal | Bestandteil | Wie erkennen |
|---|---|---|
| OpenAPI/Swagger-Datei oder -Generator | HTTP-Endpunkte (Methode + Pfad) | Datei lesen; besser: eingecheckte, per Test aktuell gehaltene `openapi.json` |
| Express/Fastify/Nest/Hono-Router ohne OpenAPI | Endpunkte | Routen-Registrierungen parsen (`app.get('/…')`, Dekoratoren) |
| Next.js / Remix / SvelteKit / Nuxt | Seiten und API-Routen | Dateisystem-Routen (`app/**/page.tsx`, `pages/api/**`, `routes/**`) |
| React Router / Vue Router | Seiten | Routen-Definitionen (`<Route path=…>`, Router-Konfiguration) |
| GraphQL | Queries, Mutations, Subscriptions | Schema-Datei oder Introspection-Ergebnis |
| Ereignisse/Messaging | Ereignistypen | zentrale Registrierung (z. B. `defineEvent('typ', …)`), Topics |
| Hintergrundjobs/Cron | Jobs | Job-Registrierung, Scheduler-Konfiguration |
| CLI-Befehle | Kommandos | `package.json`-Scripts, CLI-Framework-Definitionen |
| Rechte | Rollen je Endpunkt | Rechtetabelle/Guards – möglichst **dieselbe Funktion importieren**, die die App zur Laufzeit nutzt |
| Tests | welcher Test welchen Endpunkt aufruft | **Heuristik** (siehe 4.3) |
| JUnit-Berichte der CI | ob ein Test bestanden hat | Testläufe mit JUnit-Reporter |

Halte auch fest, **was sich nicht erkennen lässt**: fachlicher Zuschnitt, Nutzen, Regeln, Einstellmöglichkeiten. Das
pflegst du von Hand – die Prüfung sorgt nur dafür, dass nichts vergessen wird und nichts veraltet.

### Phase 2 – Taxonomie ★

**Bereich → Gruppe → Feature.** Bereiche sind fachlich und stabil (am Ablauf der Nutzer orientiert, nicht an
Code-Modulen). Für einen Weddingplanner etwa: *Gäste*, *Budget*, *Dienstleister*, *Zeitplan*, *Sitzordnung*,
*Einladungen und Zusagen*, *Konto und Zugang*, *Integration*, *Bedienoberfläche*, *Feature-Katalog* (der Katalog
beschreibt sich selbst). Jeder Bereich legt unter `owns` fest, welche erkannten Bestandteile ihm gehören (Pfad- und
Namenspräfixe).

### Phase 3 – Datenmodell und Werkzeug

Baue das Werkzeug als eigenes Paket (z. B. `packages/feature-catalog` oder `tools/feature-catalog`) mit:
Schema (z. B. Zod/JSON-Schema), Erkennung, Analyse, JUnit-Leser, Ansicht-Generator, CLI. Details in Abschnitt 3–6.

### Phase 4 – Pilot ★

Katalogisiere **einen** Bereich vollständig (alle Bestandteile zugeordnet, alle Features nachgewiesen), zeige dem
Nutzer Ansicht und Prüfergebnis und hole Feedback zum Zuschnitt ein, bevor du die übrigen Bereiche machst.

### Phase 5 – Vollständige Bestandsaufnahme

Bereich für Bereich: Features anlegen, Nachweise eintragen, Bereich auf `status: katalogisiert` setzen (ab dann sind
nicht zugeordnete Bestandteile **Fehler**). Was keinen Test hat: Test schreiben (bevorzugt) oder in den Prüfbestand.
Ziel: Prüfbestand abbauen, bis er leer ist.

### Phase 6 – CI und Pflege

Prüfung in die CI, Ansicht als CI-Artefakt, Doku `docs/feature-katalog.md`. Ab dann gilt bei jeder Änderung: neues
Feature → Eintrag mit Nachweis; die CI erzwingt es.

---

## 3. Dateien und Datenmodell

```
catalog/
  catalog.yaml            # Bereiche, Gruppen, owns, Vergleichssysteme, Ausnahmen
  features/<bereich>.yaml # Features eines Bereichs
  review.yaml             # Prüfbestand (gleiches Format + state/reason)
  comparisons/<system>.yaml   # optional: Lücken gegenüber einem Vergleichssystem
  dist/                   # erzeugt: index.html, catalog.json (nicht einchecken)
docs/feature-katalog.md   # Regeln, Pflege, Stand
```

### 3.1 `catalog/catalog.yaml`

```yaml
schemaVersion: 1
areas:
  - id: gaeste
    title: Gäste
    summary: Gästeliste führen, Einladungen versenden und Zusagen erfassen.
    status: katalogisiert        # oder: offen (noch in Arbeit; Lücken sind dann nur Hinweise)
    owns:
      endpoints: [/api/guests, /api/invitations]   # Pfad-Präfixe
      events: [guest, invitation]                  # Typ-Präfixe bis zum Punkt
      uiRoutes: [/gaeste]
      jobs: [send-reminders]                        # weitere Bestandteilarten nach Bedarf
    groups:
      - id: gaeste.liste
        title: Gästeliste
        summary: Gäste erfassen, gruppieren, importieren.
systems:                         # optional
  - id: wettbewerber-x
    title: Produkt X
    description: Woher das Wissen über X stammt.
    complete: true               # true = jedes Feature braucht eine Einstufung
exclusions:                      # Bestandteile, die bewusst kein Feature sind – immer mit Grund
  endpoints:
    - { item: GET /api/debug/ping, reason: Nur für lokale Entwicklung }
```

**Präfix-Regel:** `/api/guests` passt auf `/api/guests` und `/api/guests/…`, **nicht** auf `/api/guests-export`.

### 3.2 Feature (`catalog/features/<bereich>.yaml`)

```yaml
area: gaeste
features:
  - id: gaeste.zusagen                     # stabil, <bereich>.<name>, nie wiederverwenden
    title: Zusagen erfassen
    group: gaeste.liste
    summary: Erfasst Zu- und Absagen je Gast samt Begleitung und Essenswunsch.   # Nutzen in einem Satz
    description: |
      Was die Funktion leistet, fachlich, ohne Code-Begriffe.
    usage:                                 # je Bedienweg
      - channel: web
        text: Seite **Gäste** – Gast wählen, „Zusage erfassen“.
      - channel: api
        text: "`POST /api/guests/{id}/rsvp` mit `status`, `plusOne?`, `meal?`"
    rules:                                 # Regeln und Grenzen, gern mit Fehlercodes
      - Nach dem Anmeldeschluss nur noch durch das Brautpaar änderbar (`RSVP_CLOSED`).
    settings: []                           # was sich einstellen lässt und wo
    dependsOn: [gaeste.liste-fuehren]      # andere Feature-IDs
    technical:
      components: [src/server/guests/rsvp.ts, src/app/gaeste/page.tsx]   # müssen existieren
      endpoints: [POST /api/guests/{id}/rsvp, GET /api/guests]           # wie in der API-Beschreibung
      events:
        emits: [guest.rsvp-changed]
        consumes: []
      uiRoutes: [/gaeste]
      notes: [Tabelle `rsvp`.]
    evidence:                              # Pflicht im Katalog, mindestens ein Eintrag
      - kind: integration                  # unit | integration | e2e | scenario …
        file: tests/integration/rsvp.test.ts
        test: speichert eine Zusage mit Begleitung      # exakter Testtitel
      - kind: e2e
        file: e2e/gaeste.spec.ts
        test: "Gäste: Zusage erfassen und in der Liste sehen"
    comparisons:                           # nur wenn Vergleichssysteme definiert sind
      wettbewerber-x:
        status: erweitert                  # gleichwertig|erweitert|eingeschraenkt|neu|abweichend|nicht-einsehbar
        note: X kennt keine Essenswünsche.
```

Prüfbestand-Einträge haben dasselbe Format plus `state` (`unvollstaendig`, `deaktiviert`, `nicht-nachgewiesen`) und
`reason`; `evidence` darf dort fehlen.

### 3.3 Lücken (`catalog/comparisons/<system>.yaml`, optional)

```yaml
system: wettbewerber-x
gaps:
  - id: wettbewerber-x.tischplan-export
    title: Tischplan als PDF
    area: sitzordnung
    summary: X exportiert den Tischplan als druckbares PDF.
    status: fehlt              # fehlt | teilweise | bewusst-weggelassen
    source: oeffentlich        # woher das Wissen stammt
    related: [sitzordnung.tische]
```

### 3.4 Schema

Definiere das Schema als Code (z. B. Zod) und validiere **strikt** (unbekannte Felder sind Fehler). Prüfe auch
Querverweise: Gruppe gehört zum Bereich, `dependsOn` existiert, IDs eindeutig, Feature-ID beginnt mit Bereichs-ID.

---

## 4. Prüfungen (CLI `catalog:check`)

Ausgabe: je Befund **Stufe**, **Code**, Datei, Feature, verständlicher Text. Exit-Code ≠ 0 bei Fehlern.

### 4.1 Regeln

| Code | Stufe | Wann |
|---|---|---|
| `SCHEMA` | Fehler | YAML ungültig oder verletzt das Schema |
| `UNASSIGNED` | Fehler (katalogisierter Bereich) / Hinweis (offener) | erkannter Bestandteil ohne Feature, Prüfbestand-Eintrag oder Ausnahme |
| `UNOWNED` | Fehler | erkannter Bestandteil, den kein Bereich über `owns` beansprucht |
| `UNKNOWN_ENDPOINT` / `UNKNOWN_EVENT` / `UNKNOWN_ROUTE` | Fehler | Feature verweist auf etwas, das es nicht (mehr) gibt |
| `UNKNOWN_COMPONENT` | Fehler | Quelldatei existiert nicht |
| `UNKNOWN_TEST` / `UNKNOWN_SCENARIO` | Fehler | Testtitel steht nicht (mehr) als String-Literal in der Datei |
| `UNKNOWN_DEPENDENCY` | Fehler | `dependsOn` zeigt ins Leere |
| `EVIDENCE_MISSING` | Fehler | Katalog-Feature ohne Nachweis |
| `EVIDENCE_FAILED` | Fehler | Nachweis ist im Testlauf fehlgeschlagen (nur mit Berichten) |
| `EVIDENCE_SKIPPED` | Fehler | Nachweis wurde übersprungen – **übersprungen zählt nicht als bestanden** |
| `EVIDENCE_NOT_RUN` | Fehler | Testart lief, der Nachweis kam darin aber nicht vor |
| `COMPARISON_MISSING` | Fehler | Vergleichssystem mit `complete: true`, Feature ohne Einstufung |
| `ENDPOINT_UNTESTED` | **Warnung** | kein Test ruft einen Endpunkt des Features erkennbar auf (Heuristik!) |

### 4.2 Nachweise gegen Testberichte

- `catalog:check --reports <dir>` liest alle `*junit*.xml`.
- Zuordnung: Testtitel (exakt oder als Ende von `Suite > Titel` bzw. `Suite › Titel`) **und** Dateiname
  (Basisname) im `classname`/`file` des Berichts.
- Welche Testart ein Bericht abdeckt, am Inhalt erkennen (Pfad `test/integration/`, `*.spec.ts`, …), nicht am
  Dateinamen. Nur für Testarten, die im Lauf vorkamen, ist ein fehlender Nachweis ein Fehler.
- Ohne `--reports`: nur statische Prüfung (Test existiert als Literal), Ausgabe sagt das deutlich.

### 4.3 Heuristik „welcher Test ruft welchen Endpunkt“

- Pfad aus der Definition in eine Regex übersetzen; Parameter `{id}` passen auf ein Segment **oder** auf einen
  Template-Ausdruck (`${guest.id}`).
- Der Treffer zählt nur, wenn **unmittelbar davor** (z. B. 80 Zeichen) eine HTTP-Methode als ganzes Wort steht
  (`get|post|put|patch|delete`, `fetch` ohne Methode = GET). Sonst würden bloße Pfadlisten (z. B. erwartete
  OpenAPI-Pfade in einem Test) als Aufruf gelten.
- Aufrufe über Hilfsfunktionen (`post(id, 'rsvp')`) bleiben unsichtbar → deshalb nur **Warnung**.
- Tipp für Tests: Helfer so benennen, dass ein Methodenwort vor dem Pfad steht (`api.get('/…')`).

### 4.4 Abgeleitete Angaben (nicht pflegen)

- **Rollen** eines Features: aus der Rechtetabelle der App für seine ändernden Endpunkte (sonst lesenden). Wenn
  möglich die Funktion der App importieren statt nachzubauen.
- **Bedienwege**: aus `usage`.
- **Nachweisstatus** je Feature: nachgewiesen / fehlgeschlagen / nicht gelaufen / nur statisch.
- **„Grundlage für“**: Umkehrung von `dependsOn`.

---

## 5. Ansicht (`catalog:build`)

Erzeuge **eine eigenständige HTML-Datei** (Daten eingebettet, kein Server, keine externen Skripte) plus
`catalog.json`:

- Kopf mit Kennzahlen: Features, Bereiche, nachgewiesen, Prüfbestand, Erzeugungszeit und Commit.
- **Navigation** links: Bereiche → Gruppen (mit Anzahl), Reiter *Katalog*, *Prüfbestand*, *Vergleich*.
- **Suche** über Titel, Zusammenfassung, Beschreibung, IDs, Endpunkte.
- **Filter** als Chips: Rolle, Bedienweg, Nachweisstatus, Einstufung im Vergleich.
- Feature-Karte: Titel, Zusammenfassung, Abzeichen (Bedienwege, Rollen, Nachweis, Einstufung); aufklappbar:
  Beschreibung, Bedienung je Weg, Regeln, Einstellungen, Abhängigkeiten/„Grundlage für“ als Links, dann
  **technische Details** (Komponenten, Endpunkte mit Zweck und Rollen, Ereignisse, Seiten, Nachweise mit Ergebnis,
  aufrufende Tests).
- Reiter *Vergleich*: Verteilung der Einstufungen, Tabelle je Bereich, Liste der Lücken.
- Hell/dunkel, mobil lesbar, Inline-Markdown (`**fett**`, `` `code` ``) in Texten.
- Die Ansicht darf **keine** Daten enthalten, die nicht auch im YAML stehen oder daraus abgeleitet sind.

---

## 6. CI

1. Testjobs schreiben **JUnit-Berichte** für jede Testart, die als Nachweis zählt – auch für die Tests des
   Katalog-Werkzeugs selbst – und laden sie als Artefakte hoch.
2. Im Hauptjob: `catalog:check` (statisch).
3. Eigener Job nach allen Testjobs: Berichte herunterladen, `catalog:check --reports reports`, dann
   `catalog:build --reports reports` und die Ansicht als Artefakt `feature-katalog` ablegen.
4. Scheitert ein Nachweis oder fehlt eine Zuordnung, schlägt der Job fehl.

---

## 7. Der Katalog beschreibt sich selbst

Lege einen Bereich `katalog` (ohne `owns`) mit Bedienweg `entwicklung` an und katalogisiere das Werkzeug selbst:
Datenmodell, Abgleich mit dem Code, Nachweise im Testlauf, Ansicht, ggf. Vergleich. Nachweise sind die Tests des
Werkzeugs. Mindest-Tests des Werkzeugs:

- „hat keine Fehler“ (der echte Katalog im Repository besteht die Prüfung)
- „ordnet jeden erkannten Bestandteil einem Bereich zu“
- „erzeugt eine eigenständige Ansicht aus denselben Daten“
- „verlangt für Katalog-Features mindestens einen Nachweis“
- „meldet nicht zugeordnete Bestandteile nur in katalogisierten Bereichen als Fehler“
- „legt nie selbst Features an, sondern meldet nur“
- „meldet Verweise auf Entferntes“
- „kennzeichnet Features, deren Nachweis im Testlauf fehlschlägt, übersprungen wird oder fehlt“
- „erkennt Aufrufe mit Methode und Parametern, nicht aber bloße Pfadlisten“
- „verlangt bei vollständigem Vergleich eine Einstufung für jedes Feature“ (falls Vergleich genutzt)

---

## 8. Pflege im Alltag (in `docs/feature-katalog.md` festhalten)

| Situation | Was tun |
|---|---|
| Neue Funktion gebaut | Feature anlegen (oder bestehendes erweitern), Nachweis eintragen, `catalog:check` |
| Neuer Endpunkt/Seite ohne eigenes Feature | einem bestehenden Feature zuordnen oder begründete Ausnahme |
| Test umbenannt | Testtitel im Nachweis anpassen (die Prüfung meldet `UNKNOWN_TEST`) |
| Funktion entfernt | Feature löschen; ID nicht wiederverwenden |
| Funktion ohne Test | Test schreiben; bis dahin Prüfbestand mit `reason` |
| Bereich fertig | `status: katalogisiert` – ab dann sind Lücken Fehler |
| Lücke zum Vergleichssystem geschlossen | Eintrag aus `comparisons/` entfernen, Einstufung des Features setzen |

Halte in der Doku auch den **Stand** fest (Features und erkannte Bestandteile je Bereich, Einstufungen, Lücken) und
aktualisiere ihn bei größeren Änderungen.

---

## 9. Erfahrungen und Fallstricke

- **YAML:** Werte mit Doppelpunkt (`"Gäste: Zusage erfassen"`) oder mit `{`/`[` in Fluss-Listen in Anführungszeichen.
  Mehrzeilige Texte mit `|`. Für Massenänderungen YAML **verlustfrei** bearbeiten (z. B. `yaml`-Paket mit
  `parseDocument`, `toString({ lineWidth: 0 })`), damit Kommentare und Formatierung bleiben.
- **Testtitel sind die Brücke:** Nachweise verweisen auf exakte Titel. Titel sprechend und stabil formulieren
  („speichert eine Zusage mit Begleitung“), nicht „test 3“.
- **Übersprungene Tests** (z. B. wegen fehlender Testdaten) sind kein Nachweis – das muss die Prüfung erzwingen.
- **Veraltete lokale Berichte** erzeugen `EVIDENCE_NOT_RUN`: vor `--reports` alle Testarten frisch laufen lassen.
- **API-Beschreibung aktuell halten:** Ein Test, der die eingecheckte API-Beschreibung mit der laufenden API
  vergleicht (mit Schalter zum Neuschreiben), macht die Endpunkt-Erkennung verlässlich.
- **Heuristiken nie als Fehler**, nur als Warnung – sonst entstehen Schein-Tests.
- **Präfixe sauber trennen** (`/api/guests` vs. `/api/guests-export`), sonst stiehlt ein Bereich dem anderen Bestandteile.
- **Zuschnitt im Pilot klären**, bevor 100 Features geschrieben sind – nachträgliches Umschneiden ist teuer.
- **Kein Feature ohne Bedienweg-Text:** Wer das Feature nutzen will, muss aus `usage` erfahren, wo und wie.
- Erfundene Beispieldaten in Texten und Tests (keine echten Kunden- oder Personendaten).

---

## 10. Abnahmekriterien

- [ ] `catalog:check` ohne Fehler; Warnungen begründet oder behoben.
- [ ] Alle Bereiche `katalogisiert`; jeder erkannte Bestandteil ist zugeordnet oder begründet ausgenommen.
- [ ] Jedes Katalog-Feature hat mindestens einen Nachweis, der im letzten CI-Lauf **bestanden** hat.
- [ ] Prüfbestand leer oder jeder Eintrag mit Grund und Plan.
- [ ] Ansicht als CI-Artefakt; Suche, Filter, Navigation und aufklappbare Technik funktionieren.
- [ ] Der Katalog beschreibt sich selbst (Bereich `katalog`).
- [ ] `docs/feature-katalog.md` erklärt Aufbau, Regeln, Pflege und Stand.
- [ ] Die Applikation selbst ist unverändert (nur Tests, Werkzeug, CI und Doku sind neu).

---

## Referenz

Vorbild ist der Katalog des WMS-Projekts (`catalog/`, `packages/feature-catalog/`, `docs/feature-katalog.md`):
TypeScript mit Zod, direkt mit Node ausgeführt (Type Stripping), Erkennung aus `openapi.json`, `defineEvent`-Aufrufen,
React-Router-Routen und Node-RED-Paketbeschreibung; JUnit aus Vitest und Playwright. Übernimm Ideen, nicht blind den
Code – Erkennung und Testarten hängen vom Stack des Zielprojekts ab.
