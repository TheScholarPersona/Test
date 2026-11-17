#!/bin/sh
# Erzeugt beim ersten Start eine lokale Zertifizierungsstelle und das
# Serverzertifikat für Mosquitto (TLS). Läuft einmal in einem kurzlebigen
# Container; vorhandene Zertifikate bleiben unverändert.
#
# Nur für die lokale Umgebung. Im Betrieb Zertifikate der eigenen PKI
# verwenden und in das Volume `certs` legen (ca.crt, server.crt, server.key).
set -eu
DIR=/certs
DAYS=825
if [ -s "$DIR/ca.crt" ] && [ -s "$DIR/server.crt" ] && [ -s "$DIR/server.key" ]; then
  echo "Zertifikate vorhanden – nichts zu tun"
  exit 0
fi
umask 077
TMP=$(mktemp -d)
openssl req -x509 -newkey rsa:3072 -nodes -days "$DAYS" -subj "/CN=WMS lokale CA" \
  -keyout "$TMP/ca.key" -out "$DIR/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=mosquitto" -keyout "$DIR/server.key" -out "$TMP/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:mosquitto,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$TMP/ext.cnf"
openssl x509 -req -in "$TMP/server.csr" -CA "$DIR/ca.crt" -CAkey "$TMP/ca.key" -CAcreateserial \
  -days "$DAYS" -extfile "$TMP/ext.cnf" -out "$DIR/server.crt" 2>/dev/null
# CA-Schlüssel wird nicht aufbewahrt: neue Zertifikate = neue CA (Volume löschen).
rm -rf "$TMP"
# Mosquitto (uid 1883) liest Zertifikat und Schlüssel, alle anderen nur die CA.
chown 1883:1883 "$DIR/server.key" "$DIR/server.crt"
chmod 600 "$DIR/server.key"
chmod 644 "$DIR/ca.crt" "$DIR/server.crt"
echo "Zertifikate erzeugt (gültig $DAYS Tage)"
