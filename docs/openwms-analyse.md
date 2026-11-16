# OpenWMS.org – Analyse, Architekturrekonstruktion und Rebuild-Plan

Stand der Analyse: 16.11.2026 · Methode: direkte Quellcodeanalyse öffentlicher Repositories (shallow clone, `master`)

> Alle Pfadangaben sind relativ zum jeweiligen Repository. `CSL` = `org.openwms.common.service.lib/src/main/java/org/openwms/common`,
> `TMS` = `org.openwms.tms.transportation/src/main/java/org/openwms/tms`, `MVL` = `org.openwms.wms.movements.lib/src/main/java/org/openwms/wms/movements`,
> `RCL` = `org.openwms.wms.receiving.lib/src/main/java/org/openwms/wms/receiving`.

---

## 0. Zusammenfassung

| Erkenntnis | Bedeutung für den Rebuild |
|---|---|
| Alle 5 genannten Repos sind öffentlich und Apache-2.0-lizenziert. | Code darf gelesen, wiederverwendet und verändert werden (mit Lizenz- und Copyright-Hinweis). |
| `common.service`, `wms.receiving` und `wms.movements` enthalten nur 2–4 Java-Dateien (Starter + Konfiguration). Die Fachlogik liegt in `*.lib`-Repos. | Die drei Lib-Repos (ebenfalls öffentlich, Apache-2.0) wurden zusätzlich analysiert. |
| Bestandsführung (Inventory, Produkte, Packaging Units) und Putaway-Strategie sind **privat** (Inventory: „Private Preview“, Putaway: „Private, GPLv3“). | Bestandsführung muss vollständig selbst entwickelt werden; Receiving und Movements sind ohne sie nur eingeschränkt lauffähig. |
| Viele Lagerregeln (max. TUs pro Platz, Maximalgewicht, Stapel-/Platzierungsregeln) werden **gespeichert, aber im Open-Source-Code nicht durchgesetzt** – nur optionale SPI-Hooks ohne Implementierung. | Diese Regeln sind der wichtigste fachliche Eigenbau-Anteil. |
| Mehrere Fehler im Originalcode gefunden (Kap. 6.4). | Nicht 1:1 übernehmen. |
| Schema entsteht per Hibernate `ddl-auto` (keine Flyway/Liquibase-Migrationen). | Im Rebuild eigene, versionierte Migrationen. |

**Empfehlung (aktualisiert):** Eigene Anwendung in **TypeScript** als **modularer Monolith** (Node.js, NestJS, PostgreSQL, MikroORM, Zod) mit denselben fachlichen Modulgrenzen wie OpenWMS. **Node-RED** wird als Integrationsschicht angebunden (MQTT-Events + REST-API), die Geschäftsregeln bleiben im Kern. Code fachlich neu schreiben, OpenWMS als Referenz für Konzepte und Zustandsautomaten nutzen. Grund für TypeScript statt Java: geringe Java-Erfahrung im Team, vorhandene Node-RED-Erfahrung, eine Sprache für Backend, Frontend und Node-RED-Nodes.

---

## 1. Phase 1 – Repository-Analyse

### 1.1 Verfügbarkeit

| Repository | Status | Letzter Commit | Main-/Test-Java-Dateien |
|---|---|---|---|
| `openwms/org.openwms` | öffentlich | 2026-07-13 (`9d263bf`) | 61 / 3 (`org.openwms.core.util` + Doku) |
| `openwms/org.openwms.common.service` | öffentlich | 2026-03-21 (`fc7edd4`) | 4 / 1 |
| `openwms/org.openwms.wms.receiving` | öffentlich | 2025-03-30 (`00d5b97`) | 2 / 1 |
| `openwms/org.openwms.wms.movements` | öffentlich | 2026-02-17 (`76dfd28`) | 2 / 0 |
| `openwms/org.openwms.tms.transportation` | öffentlich | 2025-03-19 (`bf224eb`) | 90 / 14 |
| *zusätzlich:* `org.openwms.common.service.lib` | öffentlich | 2026-02-22 (`a6566d7`) | 186 / 40 |
| *zusätzlich:* `org.openwms.wms.receiving.lib` | öffentlich | 2025-03-30 (`1951f35`) | 175 / 14 |
| *zusätzlich:* `org.openwms.wms.movements.lib` | öffentlich | 2026-02-20 (`f9a87f2`) | 82 / 6 |
| *zusätzlich:* `org.openwms.parent` | öffentlich | 2026-07-13 (`52a8829`) | Parent-POM |

Nicht zugänglich (privat, bewusst nicht versucht zu umgehen): `org.openwms.wms.inventory(.lib)`, `org.openwms.wms.shipping`, `org.openwms.common.api` u. a.
Laut `org.openwms/README.md` sind u. a. privat: Inventory Service, Picking Library (GPLv3), Putaway Library (GPLv3), WMS Tasks, Shipping, Partner, SAP-/Dynamics-Adapter, Printing.

### 1.2 Lizenzen

- Alle analysierten Repos: **Apache License 2.0** (`LICENSE`). Datei-Header: `Copyright 2005-2025 the original author or authors.` Keine `NOTICE`-Dateien.
- Abhängigkeit `io.interface21:ameba-lib`: Apache-2.0 (laut POM auf Maven Central).
- UI-Erweiterungen (`interface21-io/*.ui`) sind **GPLv3** – nicht verwenden, wenn die eigene Anwendung nicht GPL werden soll.
- Apache-2.0 gewährt **keine Markenrechte** (§ 6): Die eigene Anwendung darf nicht „OpenWMS“ heißen oder als solches auftreten.

### 1.3 Java-, Spring- und Build-Versionen

| Repo | Parent-POM | Java | Spring Boot | Spring Cloud | ameba-lib |
|---|---|---|---|---|---|
| org.openwms (core.util) | 28.0 | 25 | 4.1.0 | – | 4.3.0 |
| common.service(.lib) | 27.7.1 | 21 | 3.5.9 | 2025.0.0 | 4.2.1 |
| wms.movements(.lib) | 27.7.1 | 21 | 3.5.9 | 2025.0.0 | 4.2.1 |
| wms.receiving(.lib) | 27.2 | 21 | 3.4.2 | 2024.0.0 | 4.1.0 |
| tms.transportation | 27.2 | 21 | 3.4.2 | 2024.0.0 | 4.1.0 |

Build: Maven 3.9.9 (Wrapper), MapStruct 1.6.3, springdoc-openapi, Jib für Container-Images, Docker-Dateien je Service. Versionen der Parents 27.x stammen aus den veröffentlichten POMs auf Maven Central, 28.x aus `org.openwms.parent/pom.xml:623,649`.

Infrastruktur je Service: PostgreSQL (H2 für Tests), RabbitMQ (`spring-boot-starter-amqp`), Spring Cloud Config + Bootstrap, Eureka-Client, OpenFeign, Spring Cloud Bus, Micrometer/Prometheus, OpenTelemetry-Tracing, Spring Security (Common, TMS).

### 1.4 Projektstruktur (einheitliches Muster)

Jedes Fachmodul folgt demselben Schnitt:

```
<fachkonzept>/            Entities, Services (Schnittstelle), Controller, Mapper
<fachkonzept>/api/        öffentliche VOs + Feign-Client-Interfaces (für andere Services)
<fachkonzept>/api/messages  AMQP-Nachrichtenobjekte (MO)
<fachkonzept>/commands/   eingehende AMQP-Kommandos
<fachkonzept>/events/     Domain-Events + Propagatoren nach AMQP
<fachkonzept>/impl/       Service-Implementierungen, Repositories (package-private)
<fachkonzept>/spi/        Erweiterungspunkte (Approval, Resolver, Validatoren)
app/                      Spring-Konfiguration (Module, Security, Async, Feign)
```

Pakete mit den meisten Klassen: `common/location` (20), `common/location/api` (15), `common/transport` (13), `wms/receiving/impl` (29), `wms/receiving/api` (19), `wms/receiving/spi/wms/inventory` (17), `tms` (15), `tms/impl/state` (11).

---

## 2. Domänenmodell

### 2.1 Entitäten und Tabellen

| Modul | Entität | Tabelle | Kernfelder (Datei:Zeile) |
|---|---|---|---|
| Common | `Location` (extends `Target`) | – | `locationId: LocationPK` (78), `erpCode` (91), `plcCode` (87), `noMaxTransportUnits` (114), `maximumWeight` (120), `incomingActive` (150), `outgoingActive` (163), `plcState` (176), `consideredInAllocation` (188), `locationType` (195), `locationGroup` (209) – `CSL/location/Location.java` |
| Common | `LocationPK` (Embeddable) | – | `area, aisle, x, y, z` (45–65) – `CSL/location/LocationPK.java` |
| Common | `LocationGroup` | `COM_LOCATION_GROUP` | `name` (62), `groupType` (77), `operationMode` (86), `groupStateIn/Out` (92/103), `stateInLocker/stateOutLocker` (97/108), `maxFillLevel` (112), `parent` (122), `locationGroups` (126), `locations` (130) |
| Common | `LocationType` | `COM_LOCATION_TYPE` | `type, length, width, height` |
| Common | `TransportUnit` | `COM_TRANSPORT_UNIT` | `barcode` (77), `empty` (81), `weight` (95), `state` (99), `actualLocation` (104), `targetLocation` (109), `transportUnitType` (114), `parent/children` (119/132), `errors` (137), `reservations` (141) – `CSL/transport/TransportUnit.java` |
| Common | `TransportUnitType` | `COM_TRANSPORT_UNIT_TYPE` | `type`, Maße, `weightTare/weightMax/payload` (79–87), `typeStackingRules` (103), `typePlacingRules` (108) |
| Common | `TypeStackingRule` | `COM_TYPE_STACKING_RULE` | `baseTransportUnitType`, `noTransportUnits`, `allowedTransportUnitType` |
| Common | `TypePlacingRule` | `COM_TYPE_PLACING_RULE` | `transportUnitType`, `privilegeLevel`, `allowedLocationType` |
| Common | `UnitError`, `TransportUnitReservation`, `NextBarcode`, `Account`, `Message`, `ReplicaRegistry` | `COM_UNIT_ERROR`, `COM_TU_RESERVATION`, `COM_BARCODE`, `COM_ACCOUNT`, `COM_MESSAGE`, `COM_REPLICA_REGISTRY` | Fehler, Reservierungen, Barcode-Zähler, Mandant |
| TMS | `TransportOrder` | `TMS_TRANSPORT_ORDER` | `transportUnitBK` (51), `priority` (59), `startDate/endDate` (66/79), `problem` (72), `state` (86), `sourceLocation` (92), `targetLocation` (98), `targetLocationGroup` (105) – `TMS/TransportOrder.java` |
| TMS | `ProblemHistory` | `TMS_PROBLEM_HISTORY` | Historie von Problemen eines Auftrags |
| Movements | `Movement` | `MVM_MOVEMENT` | `transportUnitBk` (64), `type` (70), `initiator` (75), `group` (80), `sku` (84), `priority` (93), `mode` (99), `state` (104), `source/target`-Felder (116–130), Termine (135–150) – `MVL/impl/Movement.java` |
| Movements | `MovementGroup` | `MVM_MOVEMENT_GROUP` | `name, state, assignedUser, movements` |
| Receiving | `ReceivingOrder` | `WMS_REC_ORDER` | `orderId` (82), `orderState` (87), `locked` (97), `priority` (101), Termine (106–131), `problem` (135), `positions` (141), `details` (153) – `RCL/impl/ReceivingOrder.java` |
| Receiving | `AbstractReceivingOrderPosition` → `ReceivingOrderPosition` / `ReceivingTransportUnitOrderPosition` | (Vererbung) | `posNo`, `state`; Mengenposition: `quantityExpected/Received: Measurable`, `product`; TU-Position: `transportUnitBK`, `transportUnitTypeName` |
| Receiving | `Product`, `TransportUnit` (Replikate) | `WMS_REC_PRODUCT`, `WMS_REC_TRANSPORT_UNIT` | lokale Kopien aus Inventory/Common (per Events gepflegt) |

```mermaid
erDiagram
    LOCATION_GROUP ||--o{ LOCATION_GROUP : "parent/children"
    LOCATION_GROUP ||--o{ LOCATION : contains
    LOCATION_TYPE ||--o{ LOCATION : types
    LOCATION ||--o{ TRANSPORT_UNIT : "actualLocation"
    LOCATION ||--o{ TRANSPORT_UNIT : "targetLocation"
    TRANSPORT_UNIT_TYPE ||--o{ TRANSPORT_UNIT : types
    TRANSPORT_UNIT ||--o{ TRANSPORT_UNIT : "parent/children"
    TRANSPORT_UNIT ||--o{ UNIT_ERROR : has
    TRANSPORT_UNIT ||--o{ TU_RESERVATION : has
    TRANSPORT_UNIT_TYPE ||--o{ TYPE_STACKING_RULE : "base"
    TRANSPORT_UNIT_TYPE ||--o{ TYPE_PLACING_RULE : has
    LOCATION_TYPE ||--o{ TYPE_PLACING_RULE : "allowed"
    TRANSPORT_ORDER }o..|| TRANSPORT_UNIT : "transportUnitBK (fachl. Schlüssel)"
    MOVEMENT_GROUP ||--o{ MOVEMENT : groups
    MOVEMENT }o..|| TRANSPORT_UNIT : "transportUnitBk"
    RECEIVING_ORDER ||--o{ RECEIVING_ORDER_POSITION : positions
    RECEIVING_ORDER_POSITION }o--|| PRODUCT : "Mengenposition"
```

Wichtig: Zwischen den Services gibt es **keine Fremdschlüssel**. Verknüpft wird über fachliche Schlüssel (Barcode, `erpCode`, LocationId als String, Gruppenname). Jeder Service hat eine eigene Datenbank.

### 2.2 Zustände und Übergänge

**TransportOrder** (`TMS/TransportOrderState.java:26–44`, Logik `TMS/impl/state/StateManagerImpl.java:62–118`)

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> INITIALIZED : TU-BK und Ziel gesetzt (:73–87)
    CREATED --> CANCELED
    INITIALIZED --> STARTED : kein anderer STARTED-Auftrag für dieselbe TU (:96)
    INITIALIZED --> CANCELED
    INITIALIZED --> ONFAILURE
    STARTED --> FINISHED
    STARTED --> CANCELED
    STARTED --> ONFAILURE
    STARTED --> INTERRUPTED
    FINISHED --> [*]
    CANCELED --> [*]
    ONFAILURE --> [*]
```
Regeln: kein Rückwärtsübergang (`:68`), Endzustände sind final (`:106`), `startDate` bzw. `endDate` werden beim Übergang gesetzt. Hinweis: `INTERRUPTED` existiert im Enum, wird aber vom StateManager nicht explizit behandelt (es fällt in den `default`-Zweig → `IllegalStateException`, wenn aus INTERRUPTED weitergeschaltet wird).

**TransportUnit-Zustand** (`CSL/transport/api/TransportUnitState`): `AVAILABLE`, `QUALITY_CHECK`, `BLOCKED` – freie Übergänge, nur über optionalen Hook `TransportUnitStateChangeApproval` prüfbar (`CSL/transport/impl/TransportUnitServiceImpl.java:463`).

**LocationGroup** (`CSL/location/LocationGroup.java`): getrennte Zustände `groupStateIn` / `groupStateOut` ∈ {`AVAILABLE`, `NOT_AVAILABLE`}. Sperren werden **rekursiv an Untergruppen vererbt**; die sperrende Gruppe wird als `stateInLocker/stateOutLocker` gemerkt, Untergruppen können eine von oben gesetzte Sperre nicht selbst aufheben (`:247`, `:290`). Statuswechsel ist nur erlaubt, wenn die Elterngruppe verfügbar ist (`:579`, `:586`).

**Location**: Flags `incomingActive` / `outgoingActive` (`isInfeedBlocked()` = `!incomingActive`, `Location.java:404`), zusätzlich `plcState` (Fehlerzustand der Anlagensteuerung) und Sperrtypen `ALLOCATION_LOCK`, `OPERATION_LOCK`, `PERMANENT_LOCK` mit Modi `IN`, `OUT`, `IN_AND_OUT`, `NONE` (`TargetController`).

**Movement** (`MVL/spi/DefaultMovementState`): `INACTIVE → ACTIVE → DONE`, `→ CANCELLED`. Startzustand/Endzustand sind über `MovementStateResolver` konfigurierbar. Typen: `MANUAL, STOCK_CHECK, INBOUND, OUTBOUND, CLEARING, EMPTIES, REPLENISHMENT, RECONCILIATION, RELOCATION, WAREHOUSE_RELOCATION`.

**ReceivingOrder / Position** (`RCL/api/OrderState`, `PositionState`)

```mermaid
stateDiagram-v2
    direction LR
    state Auftrag {
        [*] --> UNDEFINED
        UNDEFINED --> CREATED
        CREATED --> VALIDATED
        CREATED --> PROCESSING : mind. 1 Position PROCESSING
        VALIDATED --> PROCESSING
        CREATED --> COMPLETED : alle Positionen COMPLETED
        PROCESSING --> PARTIALLY_COMPLETED : keine offene Position, mind. 1 PARTIALLY_COMPLETED
        PROCESSING --> COMPLETED : keine offene Position, mind. 1 COMPLETED
        PROCESSING --> CANCELED : keine offene Position, alle storniert
        CREATED --> CANCELED : Storno nur aus UNDEFINED/CREATED/VALIDATED
    }
```
„Offen“ = Position in `CREATED` oder `PROCESSING` (`ReceivingOrder.java:263–280`). Achtung: Ein Auftrag mit einer abgeschlossenen und einer stornierten Position wird `COMPLETED`.
Der Auftragsstatus wird **aus den Positionsstatus abgeleitet** (`RCL/impl/ReceivingOrder.java:248 recalculateOrderState`), ausgelöst durch ein Event nach jedem Positionswechsel (`RCL/impl/ReceivingOrderPositionEventListener.java:52`, `@TransactionalEventListener` + `REQUIRES_NEW`). Stornieren nur in frühen Zuständen (`ReceivingOrder.java:218ff.`).

---

## 3. Phase 2 – Architekturrekonstruktion

### 3.1 Architekturdiagramm

```mermaid
flowchart TB
    subgraph Infra["Infrastruktur (Spring Cloud)"]
        EUR[Eureka<br/>Service Registry]
        CFG[Config Server]
        GW[API Gateway]
        MQ[(RabbitMQ)]
    end
    subgraph Public["Öffentlich (Apache-2.0)"]
        COM[common-service<br/>Lagerstruktur + TUs]
        TMS[tms-service<br/>Transportaufträge]
        MVM[movement-service<br/>Lagerbewegungen]
        REC[wms-receiving<br/>Wareneingang]
    end
    subgraph Private["Privat / nicht verfügbar"]
        INV[wms-inventory<br/>Produkte, Bestand, Putaway]
        TX[common-transactions]
        SHP[wms-shipping]
        ROUT[tms-routing / Anlagen-Treiber]
    end
    GW --> COM & TMS & MVM & REC
    COM & TMS & MVM & REC -. Registrierung .-> EUR
    COM & TMS & MVM & REC -. Konfiguration .-> CFG
    TMS -- Feign --> COM
    MVM -- Feign --> COM
    MVM -- Feign --> INV
    REC -- Feign --> COM
    REC -- Feign --> INV
    COM & TMS & MVM & REC <--> MQ
    MQ <--> INV & TX & SHP & ROUT
    COM & TMS & MVM & REC --> DB[(PostgreSQL<br/>je Service eigene DB)]
```

### 3.2 Service-Landkarte

| Service (Eureka-Name) | Verantwortung | Besitzt Daten | Ruft synchron auf | Hört auf (Queue → Exchange/Key) | Veröffentlicht |
|---|---|---|---|---|---|
| `common-service` | Lagerstruktur (Plätze, Gruppen, Typen), Transporteinheiten, Barcodes, Reservierungen, Mandanten | Location, LocationGroup, TU, TUT, Regeln | – | `common-loc-commands-queue` (`common.loc.commands`/`common.loc.command.in.*`), `common-tu-commands-queue` (`common.tu.commands`/`common.tu.command.in.*`), `common-registration-commands-queue`, `common-split-queue` (`shipping`/`split.event.created`) | `common.lg`: `lg.event.*`; `common.tu`: `loc.event.*`, `tu.event.*`, `tut.event.*`; `common.tu.commands`: `common.tu.command.out.removing|update-cache`; `common.tx.commands` |
| `tms-service` | Transportaufträge, Start-Steuerung, Zielumleitung | TransportOrder | `common-service` (Location/LocationGroup-API) | `tms-to-commands` (`tms.commands`/`to.*`), `tms-tu-commands-queue` (`common.tu.command.out.removing`), `tms-to-requests` (`tms.requests`/`response.state.change`) | `tms.events`: `to.event.created|started|finished|canceled`; `common.tu.command.in.remove|change-target`; `request.state.change` |
| `movement-service` | Lagerbewegungen (manuell, Einlagerung, Umlagerung, Nachschub) | Movement, MovementGroup | `common-service`, `wms-inventory` (Putaway) | `movements-command-queue` (`movements.commands`/`movement.command.create`), `movements-split-queue` | `movements`: `movement.event.created|moved|completed|cancelled`; `common.tu.command.in.changetarget`; `common.tx.command.in.create` |
| `wms-receiving` | Wareneingang: Avis, Erfassung (Menge, TU, blind), Abschluss | ReceivingOrder, Positionen, Produkt-/TU-Replikate | `common-service`, `wms-inventory` (Produkte, Packaging Units, Locations) | `receiving-products-queue` (`inventory`/`product.event.#`), `receiving-tu-queue` (`common.tu`/`tu.event.#`) | `receiving`: `receiving.event.ro.*`, `receiving.event.rop.*`; `common.tu.command.in.create|move`; `inventory.commands`/`pu.command.create` |

Belege: `*/src/main/resources/bootstrap.yml` (Abschnitt `owms.commands`, `owms.events`), `@RabbitListener` u. a. in `CSL/transport/commands/TransportUnitCommandListener.java:51`, `TMS/commands/TransportOrderCommandHandler.java:57`, `TMS/impl/removal/TransportUnitRemovalListener.java:76`, `MVL/commands/MovementCommandListener.java:52`, `RCL/transport/event/TransportUnitMessageListener.java:58`.

### 3.3 API-Übersicht (REST)

**common-service**

| Ressource | Endpunkte |
|---|---|
| `/v1/locations` | `GET` (alle, `?locationId`, `?erpCode`, `?plcCode`, `?locationGroupNames`), `GET /{pKey}`, `POST`, `PUT`, `DELETE /{pKey}`, `PATCH /{pKey}?op=change-state`, `PATCH ?locationId&op=change-state`, `POST ?erpCode&type&mode` (Sperren) |
| `/v1/location-groups` | `GET` (alle, `?name`, `?names`), `POST`, `PUT /{pKey}`, `DELETE /{pKey}`, `PATCH ?name&op=change-state`, `PATCH /{pKey}?op=change-state` |
| `/v1/location-types` | `GET` (alle, `?typeName`), `GET /{pKey}` |
| `/v1/targets/{targetBK}` | `POST ?type&mode` (ALLOCATION/OPERATION-Lock), `POST ?type=PERMANENT_LOCK&mode=lock|unlock` |
| `/v1/transport-units` | `GET` (alle, `?bk`, `?bks`, `?actualLocation`), `GET /{pKey}`, `POST ?bk`, `POST ?actualLocation&tut` (mit Barcode-Generierung), `PUT ?bk`, `PATCH ?bk&newLocation` (**Bewegen**), `DELETE /{pKey}`, `POST /synchronize`, `POST /block|/available|/quality-check ?bk`, `POST ?bk&state`, `POST /error ?bk&errorCode` |
| `/v1/transport-unit-types` | `GET` (alle, `?type`), `GET /{pKey}` |
| `/v1/accounts` | `GET` (alle, `?default`, `?identifier`, `?name`), `GET /{pKey}` |
| `/allocation/generic` | `POST` (einfache TU-Allokation, `SimpleGenericAllocator`) |

**tms-service** (`TMS/TransportationController.java`): `GET /v1/transport-orders?barcode&state`, `GET /{pKey}`, `POST` (anlegen), `POST ?barcode&target` (Kurzform), `PATCH /{pKey}`, `POST /{pKey}?state` (Statuswechsel).

**movement-service** (`MVL/MovementController`): `POST /v1/transport-units/{bk}/movements`, `GET /v1/movements` (alle, `?barcode&types&states`, `?state&types`), `PATCH /{pKey}` (bewegen), `PATCH /{pKey}/complete`, `DELETE /{pKey}` (stornieren).

**wms-receiving**: `POST /v1/receiving-orders`, `GET /v1/receiving-orders` (alle, `?orderId`), `GET /{pKey}`, `PUT|PATCH /{pKey}`, `POST /{pKey}/capture` (Erfassung gegen Auftrag), `POST /v1/capture` (Blind-Erfassung), `POST /{pKey}/complete`.

Konventionen: versionierte Pfade `/v1`, Media-Types wie `application/vnd.openwms.common.location-opt-v1+json`, HATEOAS-`/index`-Endpunkte je Ressource, `pKey` = technischer Schlüssel, `bk` = Business Key (Barcode).

### 3.4 Ereignis- und Nachrichtenübersicht

```mermaid
sequenceDiagram
    autonumber
    participant ERP
    participant REC as wms-receiving
    participant INV as wms-inventory (privat)
    participant COM as common-service
    participant MVM as movement-service
    participant TMS as tms-service
    ERP->>REC: POST /v1/receiving-orders
    REC-->>MQ: receiving.event.ro.* (Exchange receiving)
    Note over REC: Erfassung POST /{pKey}/capture
    REC->>COM: common.tu.command.in.create / move
    REC->>INV: pu.command.create (Packaging Unit)
    COM-->>REC: tu.event.created / moved (common.tu)
    Note over MVM: Einlagerung
    MVM->>INV: POST /v1/location-groups (Putaway, optional)
    MVM->>COM: common.tu.command.in.changetarget
    MVM-->>MQ: movement.event.created|moved|completed
    Note over TMS: Transport
    TMS->>COM: GET Location/LocationGroup (Feign)
    TMS-->>MQ: to.event.created|started|finished
    TMS->>COM: common.tu.command.in.change-target
    COM-->>TMS: common.tu.command.out.removing (vor TU-Löschung)
```

Muster im Code:
1. **Domain-Event intern → Propagator → AMQP.** Services publizieren Spring-`ApplicationEvent`s; `*EventPropagator`-Klassen senden sie nach Commit an RabbitMQ (z. B. `TMS/events/TransportOrderEventPropagator.java`, `CSL/transport/events/TransportUnitEventPropagator.java`).
2. **Kommandos per AMQP** mit Typ im Payload (`TUCommand.Type`: `REQUEST, UPDATE_CACHE, CREATE, REMOVING, REMOVE, CHANGE_TARGET, CHANGE_ACTUAL_LOCATION`), Auswertung per `switch` in `CSL/transport/commands/TransportUnitCommandHandler.java:61`. Der Routing-Key ist dadurch nur grob relevant (`common.tu.command.in.*`) – Movements nutzt `…changetarget`, TMS `…change-target`; beides kommt an.
3. **Zwei-Phasen-Löschung**: Vor dem Löschen einer TU sendet Common `common.tu.command.out.removing`; TMS prüft und lehnt ab, wenn ein STARTED-Auftrag existiert (`TMS/impl/removal/TransportUnitRemovalHandler.java:76,103,153`). Gleiches Muster für Locations über `ReplicaRegistry` (`CSL/location/impl/LocationRemovalManagerImpl.java:121,212`).
4. **Replikate**: Receiving hält lokale Kopien von Produkten und TUs, die per Events aktualisiert werden.
5. **Fehlerbehandlung**: Fehler in Listenern → `AmqpRejectAndDontRequeueException` → Dead-Letter-Exchange je Service (`dle.common`, `dle.transportation`, `dle.receiving`, `dle.inventory`).

### 3.5 Geschäftsregel-Katalog

| ID | Regel | Beleg | Im OSS durchgesetzt? |
|---|---|---|---|
| **Lagerstruktur** ||||
| L-01 | Location wird fachlich über `area/aisle/x/y/z` identifiziert; LocationId ist nach Anlage unveränderlich. | `CSL/location/LocationPK.java:45–65,93`; `LocationMapper.java:78` | ja |
| L-02 | LocationType einer Location kann nicht geändert werden, wenn er bereits gesetzt ist. | `CSL/location/Location.java:464` | ja |
| L-03 | LocationGroups sind hierarchisch; Sperre (In/Out) wird rekursiv an Kinder vererbt und kann nur von der sperrenden Gruppe aufgehoben werden. | `CSL/location/LocationGroup.java:247,290` | ja |
| L-04 | Statuswechsel einer Gruppe nur, wenn Elterngruppe verfügbar. | `LocationGroup.java:579,586` | ja |
| L-05 | Location darf nicht gelöscht werden, solange TUs darauf stehen oder ein anderer Service widerspricht. | `CSL/location/impl/LocationRemovalManagerImpl.java:121,128,212` | ja |
| L-06 | Max. Anzahl TUs pro Platz (`noMaxTransportUnits`), Maximalgewicht. | `Location.java:114,120` | **nein** (nur gespeichert) |
| **Transporteinheiten** ||||
| T-01 | Barcode ist fachlicher Schlüssel; Barcodes können generiert werden (`NextBarcode`). | `CSL/transport/barcode/*` | ja |
| T-02 | Bewegen auf den aktuellen Platz ist ein No-Op. | `CSL/transport/impl/TransportUnitServiceImpl.java:243` | ja |
| T-03 | Bewegen und Statuswechsel sind über `TransportUnitMoveApproval` / `TransportUnitStateChangeApproval` prüfbar. | `TransportUnitServiceImpl.java:230–240,463` | **nur Hook, keine Implementierung** |
| T-04 | Stapel- und Platzierungsregeln je TU-Typ. | `TransportUnitType.java:103,108`, `TypeStackingRule`, `TypePlacingRule` | **nein** (nur gespeichert) |
| T-05 | TU darf nicht gelöscht werden, wenn ein STARTED-Transportauftrag existiert; INITIALIZED-Aufträge werden storniert. | `TMS/impl/removal/TransportUnitRemovalHandler.java:103,153` | ja (konfigurierbar) |
| **Transportaufträge** ||||
| O-01 | Initialisierung nur mit TU-Barcode und Ziel (Platz oder Gruppe). | `TMS/impl/state/StateManagerImpl.java:73–87` | ja |
| O-02 | Pro TU höchstens ein STARTED-Auftrag. | `StateManagerImpl.java:96` | ja |
| O-03 | Keine Rückwärtsübergänge, Endzustände final. | `StateManagerImpl.java:68,106` | ja |
| O-04 | Start nur, wenn Zielgruppe bzw. Zielplatz nicht für Einlagerung gesperrt ist. | `TMS/impl/state/Starter.java:128,131,139` | ja |
| O-05 | Initialisierungsreihenfolge: Priorität, dann Anlagereihenfolge (pk). | `TMS/impl/state/TransportStartComparator.java:45`, `Initializer.java:68` | ja |
| O-06 | Nach Abschluss wird der nächste INITIALIZED-Auftrag der TU gestartet. | `Starter.java:86` | ja |
| O-07 | Zielumleitung über Voter-Kette (Platz/Gruppe verfügbar?). | `TMS/impl/redirection/TargetRedirector.java:49` | ja |
| **Lagerbewegungen** ||||
| M-01 | Movement ohne Ziel wird abgelehnt; Typ wird ggf. per Resolver bestimmt. | `MVL/impl/handler/AbstractMovementHandler.java:52`; `MVL/impl/MovementServiceImpl.java:186,189` | ja |
| M-02 | Abgeschlossenes Movement kann nicht mehr bewegt werden. | `MovementServiceImpl.java:233` | ja |
| M-03 | Abschluss/Storno nur aus „niedrigeren“ Zuständen (Ordinal-Vergleich). | `MovementServiceImpl.java:261,287` | ja (fragil, s. 6.4) |
| M-04 | Einlagerziel per Putaway-Strategie (externer, privater Dienst). | `MVL/impl/PutawayAdapter.java:55,66` | optional |
| **Wareneingang** ||||
| R-01 | `orderId` eindeutig. | `RCL/impl/ReceivingServiceImpl.java:89` | ja |
| R-02 | Mengenerfassung: passende offene Position mit gleichem Produkt **und gleicher Einheit** und ausreichender Restmenge; sonst erste offene Position nur bei `overbookingAllowed`. | `RCL/impl/QuantityCaptureRequestCapturer.java:100,104–105,110,117` | ja |
| R-03 | Position wird COMPLETED, sobald `received ≥ expected`, sonst PROCESSING. | `QuantityCaptureRequestCapturer.java:128–131` | ja |
| R-04 | TU-Erfassung erfordert TU-Typ; erfüllt eine offene TU-Position und bucht die TU auf den Erfassungsplatz. | `RCL/impl/TUCaptureRequestCapturer.java:81,105,109,111` | ja |
| R-05 | Auftragsstatus wird aus Positionsstatus berechnet. | `RCL/impl/ReceivingOrder.java:248–263` | ja |
| R-06 | Storno nur in UNDEFINED/CREATED/VALIDATED. | `ReceivingOrder.java:218ff.` | ja |
| R-07 | Manueller Statuswechsel nur nach COMPLETED. | `ReceivingServiceImpl.java:238` | ja |

### 3.6 Abhängigkeitsdiagramm (Build-Zeit)

```mermaid
flowchart LR
    parent[org.openwms.parent<br/>27.x/28.x] --> all((alle Module))
    ameba[io.interface21:ameba-lib<br/>Apache-2.0] --> util[org.openwms.core.util]
    units[org.openwms.core.units<br/>Measurable/Weight] --> csl
    util --> csl[common.service.lib]
    csl --> cs[common.service]
    csl --> mvl[wms.movements.lib]
    mvl --> mv[wms.movements]
    util --> rcl[wms.receiving.lib]
    units --> rcl
    rcl --> rc[wms.receiving]
    csl -. "API-Client (LocationApi,<br/>LocationGroupApi)" .-> tms[tms.transportation]
    ui1[[common.service.ui<br/>GPLv3]] -. optional .-> cs
    ui2[[wms.receiving.ui / movements.ui<br/>GPLv3]] -. optional .-> rc & mv
```

Hinweis: Receiving- und Movements-Lib duplizieren einzelne Klassen aus Common (z. B. `org/openwms/common/transport/api/commands/*`, `Barcode`), statt sie als Abhängigkeit zu beziehen.

---

## 4. Eingesetzte Werkzeuge (REA)

REA 6.9.0 ist in dieser Umgebung verfügbar (u. a. `inspect_artifact`, `binary_overview`, `analyze_javascript_application`, `inspect_managed_artifact`). Für diese Analyse wurde **bewusst kein REA-Werkzeug eingesetzt**: Der gesamte relevante Code liegt als lesbarer Java-Quelltext unter Apache-2.0 vor; Dekompilierung oder Binäranalyse hätte keinen zusätzlichen Erkenntnisgewinn gebracht. Sinnvoller REA-Einsatz später: Analyse der veröffentlichten JARs/Docker-Images auf Maven Central bzw. Docker Hub, falls Stände ohne Quellcode verglichen werden müssen – ohne Ausführung unbekannter Binärdateien. Private Komponenten (Inventory, Putaway) werden **nicht** per Reverse Engineering aus Images rekonstruiert; ihre Funktion wird aus den öffentlichen Schnittstellen (Feign-Clients in `RCL/spi/wms/inventory/*`, `MVL/spi/common/putaway/PutawayApi.java`) abgeleitet und eigenständig entworfen.

---

## 5. Phase 3 – Rebuild-Plan

### 5.1 Architekturentscheidung

| Thema | OpenWMS | Empfehlung Rebuild | Begründung |
|---|---|---|---|
| Sprache/Plattform | Java 21/25, Spring Boot 3.4–4.1 | **TypeScript (strict), Node.js LTS, NestJS** | Teamerfahrung; NestJS bietet Module + Dependency Injection ähnlich Spring |
| Schnitt | 4+ Microservices + Eureka, Config, Gateway, Bus | **Modularer Monolith**, ein NestJS-Modul je Bounded Context; Grenzen per `dependency-cruiser` geprüft | Gleiche fachliche Grenzen ohne Betriebsaufwand; spätere Auftrennung möglich |
| Persistenz | JPA, `ddl-auto: create/update` | PostgreSQL + **MikroORM** (Unit of Work, Optimistic Locking per Versionsspalte) + versionierte **Migrationen** | Am nächsten am JPA-Modell, reproduzierbares Schema |
| Interne Kommunikation | RabbitMQ-Events + Feign | In-Process-Domain-Events + **Transactional Outbox** (Tabelle, im selben Commit geschrieben) | Keine verlorenen Events bei Fehlern |
| Externe Events | RabbitMQ | **MQTT** (Mosquitto) aus der Outbox, Topics `wms/<modul>/<event>` | Nativ in Node-RED und in der Lager-/Anlagenwelt üblich |
| Validierung | Jakarta Validation | **Zod** an allen Systemgrenzen, daraus OpenAPI | Typen existieren zur Laufzeit nicht |
| Mengen/Gewichte | `org.openwms.core.units` (Measurable) | eigener `Quantity`-Wertetyp auf **`decimal.js`**, DB-Spalten `NUMERIC` | **Nie `number` für Mengen** (Float-Fehler) |
| Fachliche Schlüssel | Klassen (`Barcode`, `LocationPK`) | **Branded Types** (`Barcode`, `LocationId`, `ErpCode`) | Verwechslungsschutz bei strukturellen Typen |
| Regeln | optionale SPI-Hooks ohne Implementierung | Regeln als explizite Domain-Policies **mit** Default-Implementierung | Schließt die größte fachliche Lücke |
| Zustandsautomaten | `switch`/`ordinal()` verteilt | je Aggregat eine Übergangstabelle (erlaubte Übergänge explizit) | testbar, keine Ordinal-Abhängigkeit |
| Tests | 72 Testklassen, ungleich verteilt | **Vitest** (Unit), Testcontainers (PostgreSQL, Mosquitto), Supertest (API) | |
| Repo-Struktur | ein Repo je Service | **pnpm-Monorepo**: `apps/api`, `apps/web` (später), `packages/api-client` (aus OpenAPI generiert), `packages/node-red-nodes` | gemeinsame Typen für Kern, UI und Node-RED |

```mermaid
flowchart TB
    subgraph App["Eigene Anwendung (TypeScript/NestJS, modularer Monolith)"]
        LAY[layout<br/>Lagerstruktur]
        TU[transportunit]
        MOV[movement]
        REC[receiving]
        TO[transportorder]
        INV[inventory<br/>Bestand]
        SHARED[shared kernel<br/>Barcode, Quantity, Events]
    end
    TU --> LAY
    MOV --> TU
    MOV --> LAY
    TO --> TU
    TO --> LAY
    REC --> INV
    REC --> TU
    INV --> TU
    LAY & TU & MOV & REC & TO & INV --> SHARED
    App --> PG[(PostgreSQL)]
    App -- "Outbox → Events" --> MQTT[(MQTT-Broker<br/>Mosquitto)]
    MQTT --> NR[Node-RED]
    NR -- "REST-API (Token,<br/>Idempotency-Key)" --> App
    NR <--> EXT[Scanner, SPS/OPC UA,<br/>ERP-Import, Etikettendrucker,<br/>Benachrichtigungen]
```

### 5.1a Rolle von Node-RED

| Node-RED **ja** | Node-RED **nein** |
|---|---|
| Anlagen- und Geräteanbindung: SPS über OPC UA/Modbus, Lichtschranken, Waagen, Barcode-Scanner, Pick-by-Light | Zustandsautomaten (TU, Movement, Transportauftrag, Wareneingang) |
| Schnittstellen: ERP-Avise per CSV/REST/E-Mail einlesen und als Wareneingang anlegen | Kapazitäts-, Gewichts-, Stapel- und Platzierungsregeln |
| Reaktionen auf Events: Etikett drucken bei `tu.created`, Meldung bei `transport-order.failed` | Bestandsbuchungen und -berechnungen |
| Leitstands-Dashboards, Prototypen neuer Abläufe | direkter Datenbankzugriff |

Technische Leitplanken:
1. **Nur über die öffentliche API schreiben.** Node-RED bekommt einen eigenen API-Token mit eingeschränkten Rechten. So greifen alle Regeln im Kern auch für Node-RED.
2. **Idempotenz:** Schreibende Aufrufe tragen einen `Idempotency-Key`, damit wiederholte Flows (Retry, doppelter Scan) keine Doppelbuchungen erzeugen.
3. **Events über MQTT** mit QoS 1, eindeutiger Event-ID und Versionsfeld. Konsumenten müssen Duplikate tolerieren.
4. **Eigene Node-RED-Nodes** als npm-Paket (`packages/node-red-nodes`) mit Config-Node (URL + Token) und fachlichen Nodes wie „TU bewegen“, „Wareneingang erfassen“, „Transportauftrag anlegen“, „WMS-Event“. Die Nodes nutzen den generierten, typisierten API-Client.
5. **Flows versionieren:** Node-RED-Projects-Funktion (Git); produktive Flows im Monorepo unter `flows/`.
6. **Absicherung:** `adminAuth` aktiv, Node-RED nicht öffentlich erreichbar, Zugangsdaten nur in Node-RED-Credentials, nicht in Flows.

### 5.2 Eigenbau oder Wiederverwendung

| Baustein | Entscheidung | Begründung |
|---|---|---|
| Fachkonzepte, Zustandsautomaten, API-Schnitt | **Nachbauen** (eigener Code, OpenWMS als Referenz) | Konzepte sind nicht urheberrechtlich geschützt; eigener Code vermeidet Übernahme der gefundenen Fehler und der Infrastrukturkopplung |
| Einzelne Klassen aus `common.service.lib`, `tms.transportation` | **Zulässig**, wenn nötig | Apache-2.0: Lizenztext beilegen, Copyright-Header behalten, Änderungen kennzeichnen (§ 4). Empfehlung: nur punktuell, z. B. Barcode-Generierung |
| `org.openwms.core.units`, `ameba-lib` | **entfällt** | Java-Bibliotheken, in TypeScript nicht nutzbar; Ersatz: eigener `Quantity`-Typ auf `decimal.js` |
| Direkte Portierung von OpenWMS-Code nach TypeScript | **zulässig, aber sparsam** | Eine Übersetzung gilt als abgeleitetes Werk: Apache-2.0-Lizenz beilegen, Herkunft und Änderungen kennzeichnen. Fachlich nachbauen ist einfacher und vermeidet die Fehler aus 5.4 |
| Bestandsführung, Produkte, Packaging Units | **Eigenbau** | Original privat |
| Putaway-/Einlagerstrategie | **Eigenbau** (einfache Strategie: erster freier Platz in Zielgruppe nach `sortOrder`) | Original privat, GPLv3 |
| UI-Module (`*.ui`) | **nicht verwenden** | GPLv3 |
| Name/Logo „OpenWMS“ | **nicht verwenden** | Markenrecht, Apache-2.0 § 6 |
| Demodaten (`import-DEMO.sql`) | nur als Strukturvorbild; eigene synthetische Testdaten | keine realen Kundendaten |
| Standard-OSS: NestJS, MikroORM, Zod, decimal.js, Vitest, Testcontainers, PostgreSQL, Eclipse Mosquitto, Node-RED | **verwenden** | MIT, Apache-2.0, EPL-2.0/EDL-1.0 (Mosquitto, nur als separater Dienst betrieben) bzw. PostgreSQL-Lizenz – alle mit eigener Nutzung vereinbar; Lizenzen beim Aufsetzen nochmals prüfen |

### 5.3 Priorisierter Implementierungsplan

Reihenfolge wie gewünscht. Eine fachliche Abhängigkeit ist zu beachten: Der Wareneingang (4) bucht Bestand. Deshalb wird in Schritt 4 ein **minimales Produkt- und Bestandsmodell** angelegt, das in Schritt 6 zur vollständigen Bestandsführung ausgebaut wird.

| Prio | Schritt | Umfang | Fachliche Regeln (aus Katalog) | Abnahmekriterien |
|---|---|---|---|---|
| 0 | **Grundgerüst** | pnpm-Monorepo, TypeScript strict, NestJS, MikroORM + Migrationen, Zod → OpenAPI, Outbox + MQTT-Publisher, Vitest, Testcontainers, CI; `docker compose` mit PostgreSQL, Mosquitto, Node-RED | – | `pnpm test` grün, Modulgrenzen geprüft, Test-Event kommt in Node-RED an |
| 1 | **Lagerstruktur** | `LocationType`, `LocationGroup` (Hierarchie), `Location` (area/aisle/x/y/z, erpCode, plcCode), Sperren In/Out/Permanent | L-01 … L-05, plus **L-06 aktiv** | Anlegen/Abfragen/Sperren per REST; Sperrvererbung getestet |
| 2 | **Transporteinheiten** | `TransportUnitType`, `TransportUnit`, Barcode-Generator, Bewegen, Zustände, Fehler, Reservierungen, Eltern/Kind | T-01, T-02, **T-03/T-04 als echte Policies** (Kapazität, Gewicht, Platzierung, Stapelung), T-05 | TU anlegen, bewegen, blockieren; Policy-Verletzungen liefern fachliche Fehler; MOVED-Event enthält korrekten Vorplatz |
| 3 | **Lagerbewegungen** | `Movement`, `MovementGroup`, Typen, Handler je Typ, einfache Putaway-Strategie | M-01 … M-04 mit explizitem Zustandsautomaten | Movement anlegen, bewegen, abschließen, stornieren; ungültige Übergänge abgelehnt |
| 4 | **Wareneingang** | `ReceivingOrder`, Mengen- und TU-Positionen, Erfassung (gegen Auftrag, blind), Abschluss; **minimales Produkt + Bestandsbuchung** | R-01 … R-07 | Avis anlegen, Teil-/Vollerfassung, Überbuchung nur bei Freigabe, Auftragsstatus korrekt abgeleitet |
| 5 | **Transportaufträge** | `TransportOrder`, Zustandsautomat, Initialisierung nach Priorität, Start-Steuerung, Zielumleitung, Löschschutz für TUs | O-01 … O-07, plus definierte Behandlung von `INTERRUPTED` | Auftrag durchläuft CREATED→FINISHED; zweiter Start für dieselbe TU abgelehnt; gesperrtes Ziel verhindert Start |
| 6 | **Bestandsführung** | Produkte, Einheiten/Umrechnungen, Packaging Units (Bestand je TU/Platz), Bestandsbuchungen als Journal, Reservierung, Inventur-Grundlage | neu zu definieren (Original privat) | Bestand pro Produkt/Platz/TU abfragbar, jede Änderung als Buchung nachvollziehbar |
| 7 | **Node-RED-Nodes und Beispiel-Flows** | npm-Paket mit Config-Node und fachlichen Nodes; Beispiel-Flows: ERP-CSV → Wareneingang, Scan → TU bewegen, Event → Etikett/Meldung | Leitplanken aus 5.1a | Nodes in Node-RED installierbar; Flows laufen gegen die lokale Umgebung; Regelverletzung erscheint als Fehler im Flow |

Je Schritt: Migration, Domänenmodell mit Unit-Tests, Service, REST-Controller mit Zod-Schema/OpenAPI, Domain-Events über Outbox → MQTT, Integrationstest mit Testcontainers. Weil jeder Schritt seine Events veröffentlicht, kann Node-RED schon ab Schritt 1 für Prototypen genutzt werden; Schritt 7 macht daraus wiederverwendbare Nodes.

### 5.4 Nicht 1:1 übernehmen – gefundene Schwachstellen

| # | Stelle | Problem | Rebuild |
|---|---|---|---|
| 1 | `CSL/transport/impl/TransportUnitServiceImpl.java:248` vs. `:258` | `setActualLocation(target)` wird **vor** dem Auslesen von `previousLocation` ausgeführt → das MOVED-Event meldet als Vorplatz den neuen Platz; auch die Logzeile (`:250`) ist falsch. | Vorplatz vor dem Setzen merken |
| 2 | `MVL/impl/MovementServiceImpl.java:268` | `previousLocation = location.getErpCode()` ist der **neue** Zielplatz, nicht der vorherige. | korrekt den alten Platz übergeben |
| 3 | `MVL/impl/MovementServiceImpl.java:270` | `setTargetLocationGroup(vo.getTarget())` schreibt einen Platz-Code in das Gruppenfeld. | Gruppe aus dem aufgelösten Platz übernehmen |
| 4 | `MVL/impl/MovementServiceImpl.java:235` | Zustand wird ungeprüft aus dem Request übernommen (`valueOf(vo.getState())`) – z. B. direkt `CANCELLED` ohne Storno-Logik. | expliziter Zustandsautomat |
| 5 | `MVL/impl/MovementServiceImpl.java:261,287` | Übergangsregeln über `ordinal()` – bricht bei Umsortierung des Enums. | erlaubte Übergänge explizit definieren |
| 6 | `TMS/impl/state/StateManagerImpl.java` | `INTERRUPTED` ist definiert, aber nicht behandelt (`default` → `IllegalStateException`). | Übergänge für INTERRUPTED festlegen (→ STARTED/CANCELED/ONFAILURE) |
| 7 | `Location.java:114,120`, `TransportUnitType.java:103,108` | Kapazität, Gewicht, Stapel-/Platzierungsregeln ohne Durchsetzung. | Policies im TU-Modul |
| 8 | alle Services | Schema per `ddl-auto`. | versionierte Migrationen (MikroORM) |
| 9 | Routing-Keys | uneinheitlich (`changetarget` vs. `change-target`, `cancelled` vs. `canceled`). | einheitliches Namensschema |

### 5.5 Offene Entscheidungen für dich

1. **Monolith vs. Microservices** – Empfehlung modularer Monolith; falls Microservices gewünscht sind, verdoppelt sich der Aufwand für Schritt 0. *(Sprache entschieden: TypeScript; Node-RED als Integrationsschicht.)*
2. **Bestandsmodell** – Bestand je Packaging Unit (wie OpenWMS-Schnittstellen andeuten) oder je Platz/Produkt-Saldo mit Buchungsjournal? Empfehlung: Packaging Units + Journal.
3. **Mandantenfähigkeit** (`Account`) von Anfang an oder später?
4. **Anlagensteuerung** (`plcCode`, `plcState`, OSIP-Telegramme) – im ersten Ausbau nur als Felder, ohne Treiber?
5. **Lizenz der eigenen Anwendung** – Apache-2.0 bietet sich an, falls Codeteile übernommen werden.

---

## Anhang A – Arbeitsumgebung dieser Analyse

- Analyse lief in einem Linux-Cloud-Container (nicht auf dem Mac / in der Codex-App). Hopper steht hier nicht zur Verfügung und wurde nicht benötigt.
- Klone: `/home/user/openwms/<repo>` (shallow, temporär).
- Nicht gebaut und nicht ausgeführt: Die Services hängen von `-SNAPSHOT`-Versionen ab, die nicht auf Maven Central liegen; für die reine Analyse war ein Build nicht nötig.
- Keine Zugangsdaten verwendet, keine privaten Repositories angefragt, keine Binärdateien ausgeführt.
