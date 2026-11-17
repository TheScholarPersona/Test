#!/bin/sh
# Erzeugt die Passwortdatei aus Umgebungsvariablen und startet Mosquitto.
set -eu
: "${MQTT_API_PASSWORD:?MQTT_API_PASSWORD fehlt – pnpm env:init ausführen}"
: "${MQTT_NODE_RED_PASSWORD:?MQTT_NODE_RED_PASSWORD fehlt – pnpm env:init ausführen}"
: "${MQTT_HEALTH_PASSWORD:?MQTT_HEALTH_PASSWORD fehlt – pnpm env:init ausführen}"
FILE=/mosquitto/data/passwd
rm -f "$FILE"
touch "$FILE"
chmod 700 "$FILE"
mosquitto_passwd -b "$FILE" wms-api "$MQTT_API_PASSWORD"
mosquitto_passwd -b "$FILE" node-red "$MQTT_NODE_RED_PASSWORD"
mosquitto_passwd -b "$FILE" health "$MQTT_HEALTH_PASSWORD"
chown mosquitto:mosquitto "$FILE"
exec mosquitto -c /mosquitto/config/mosquitto.conf
