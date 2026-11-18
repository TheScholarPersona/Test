'use strict';
/**
 * JSON-Webhook: Das ERP schickt das kanonische Format direkt, einzeln oder als Liste
 * (`[...]` oder `{ messages: [...] }`). Rückmeldungen gehen unverändert als kanonisches JSON hinaus.
 */

const INBOUND_TYPES = ['product', 'receiving-order', 'outbound-order'];

/** Webhook-Body → kanonische Eingangsnachrichten (nur Grobprüfung; die API prüft genau). */
function inboundFromJson(body) {
  const value = typeof body === 'string' ? JSON.parse(body) : body;
  const list = Array.isArray(value) ? value : Array.isArray(value?.messages) ? value.messages : [value];
  return list.map((m, i) => {
    if (!m || typeof m !== 'object') throw new Error(`Nachricht ${i + 1}: kein Objekt`);
    if (!m.messageId) throw new Error(`Nachricht ${i + 1}: messageId fehlt`);
    if (!INBOUND_TYPES.includes(m.type)) throw new Error(`Nachricht ${i + 1}: type „${m.type}“ unbekannt (erlaubt: ${INBOUND_TYPES.join(', ')})`);
    if (!m.data || typeof m.data !== 'object') throw new Error(`Nachricht ${i + 1}: data fehlt`);
    return m;
  });
}

/** Kanonische Rückmeldung → Body für den ERP-Webhook. */
function outboundToJson(message) {
  return { contentType: 'application/json', body: JSON.stringify(message), fileName: `${message.type}-${message.messageId}.json` };
}

module.exports = { inboundFromJson, outboundToJson, INBOUND_TYPES };
