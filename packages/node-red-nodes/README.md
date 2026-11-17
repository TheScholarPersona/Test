# @wms/node-red-nodes

Node-RED-Nodes für das WMS (Palette „WMS“). Keine Laufzeitabhängigkeiten: REST über `fetch`, Ereignisse über den MQTT-Broker-Config-Node von Node-RED.

| Node | Zweck |
|---|---|
| `wms-config` | Verbindung: URL (z. B. `${WMS_API_URL}`), MQTT-Broker für Ereignisse, Topic-Präfix |
| `wms-api` | beliebiger API-Aufruf, Platzhalter `{name}` aus `msg.params`/`msg.payload` |
| `wms-move-tu` | TU auf einen Platz bewegen (geprüft oder physisch) |
| `wms-receive` | Wareneingang ohne Avis oder gegen einen Auftrag |
| `wms-device-event` | Geräte-Ereignis an den Materialfluss (Protokoll-Adapter) |
| `wms-event` | WMS-Ereignisse nach Typ (`stock.*`) und Feldern filtern |
| `wms-wait-event` | auf ein passendes Ereignis warten (Timeout, Zuordnung über `msg.…`) |
| `wms-test-start`, `wms-assert`, `wms-test-result` | Tests in Node-RED: starten, Felder prüfen, Ergebnis (auch für das Testframework) |

Felder nehmen feste Werte oder `msg.…`-Verweise. Fachliche Fehler (z. B. `409 PLACEMENT_REJECTED`) stehen in `msg.wmsError` und sind Node-RED-Fehler für einen Catch-Node – oder gehen mit „Fehlerausgang“ an Ausgang 2.

```bash
pnpm --filter @wms/node-red-nodes test          # Tests mit node-red-node-test-helper
node packages/node-red-nodes/scripts/build-html.mjs   # Editor-Dateien nodes/*.html neu erzeugen
```

Installation: In der Compose-Umgebung wird das Paket nach `/data/node_modules/@wms/node-red-nodes` eingebunden. In einer anderen Node-RED-Installation: `npm install <Pfad>/packages/node-red-nodes` im Node-RED-Benutzerverzeichnis (`~/.node-red`) und Node-RED neu starten.
