'use strict';
/**
 * ERP-Formate: Übersetzung zwischen konkreten ERP-Formaten und dem kanonischen Nachrichtenformat des WMS
 * (`packages/shared/src/erp.ts`). Ohne Abhängigkeiten, damit es direkt in Node-RED läuft.
 */
const { inboundFromCsv, outboundToCsv } = require('./csv-erp');
const { inboundFromIdoc, outboundToIdoc } = require('./idoc');
const { inboundFromJson, outboundToJson } = require('./json');

const FORMATS = ['json', 'csv', 'idoc'];

/**
 * Eingang → kanonische Nachrichten.
 * json: Body (Objekt/Text); csv: Text, `options.kind` = product | receiving-order | outbound-order; idoc: XML-Text.
 */
function toCanonical(format, input, options = {}) {
  switch (format) {
    case 'json':
      return inboundFromJson(input);
    case 'csv':
      if (!options.kind) throw new Error('CSV: Art der Datei fehlt (product, receiving-order, outbound-order)');
      return inboundFromCsv(options.kind, input, options);
    case 'idoc':
      return inboundFromIdoc(input, options);
    default:
      throw new Error(`Unbekanntes ERP-Format „${format}“ (erlaubt: ${FORMATS.join(', ')})`);
  }
}

/** Kanonische Rückmeldung → `{ contentType, body, fileName }` im Zielformat. */
function fromCanonical(format, message, options = {}) {
  switch (format) {
    case 'json':
      return outboundToJson(message);
    case 'csv':
      return outboundToCsv(message, options);
    case 'idoc':
      return outboundToIdoc(message, options);
    default:
      throw new Error(`Unbekanntes ERP-Format „${format}“ (erlaubt: ${FORMATS.join(', ')})`);
  }
}

module.exports = { toCanonical, fromCanonical, FORMATS };
