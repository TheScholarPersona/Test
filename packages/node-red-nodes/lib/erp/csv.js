'use strict';
/**
 * CSV lesen und schreiben (RFC 4180 mit Anführungszeichen), ohne Abhängigkeiten.
 * Trennzeichen wird beim Lesen erkannt (`;` oder `,`), Standard beim Schreiben ist `;` (Excel, deutsch).
 */

/** Text → Zeilen als Objekte (Kopfzeile = Feldnamen, getrimmt, klein geschrieben). Leere Zeilen werden übersprungen. */
function parseCsv(text, options = {}) {
  const input = String(text).replace(/^﻿/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = options.delimiter ?? (firstLine.split(';').length >= firstLine.split(',').length ? ';' : ',');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV: Anführungszeichen nicht geschlossen');
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r, index) => {
    const obj = { _line: index + 2 };
    header.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}

function escape(value, delimiter) {
  const s = value === null || value === undefined ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Objekte → CSV-Text mit Kopfzeile in der Reihenfolge von `columns`. */
function stringifyCsv(rows, columns, options = {}) {
  const delimiter = options.delimiter ?? ';';
  const eol = options.eol ?? '\r\n';
  const lines = [columns.join(delimiter), ...rows.map((r) => columns.map((c) => escape(r[c], delimiter)).join(delimiter))];
  return lines.join(eol) + eol;
}

/** Dezimalzahl aus der CSV: "12,5" oder "12.5" → "12.5"; Tausenderpunkte werden nicht erraten (Fehler). */
function decimal(value, label, line) {
  const s = String(value ?? '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Zeile ${line}: ${label} „${value}“ ist keine Zahl`);
  return s;
}

module.exports = { parseCsv, stringifyCsv, decimal };
