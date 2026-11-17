import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { authHeaders } from './app.js';

/** WinAnsi weicht von Latin-1 nur in 0x80–0x9F ab; die hier gebrauchten Zeichen. */
const WIN_ANSI: Record<number, string> = { 0x80: '€', 0x84: '„', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—' };

/**
 * Text eines von PDFKit erzeugten PDFs für Prüfungen: entpackt die Inhaltsströme und setzt die
 * Hex-Strings der Textoperatoren (WinAnsi) wieder zusammen – eine Zeile je Textoperator.
 */
export function pdfText(pdf: Buffer): string[] {
  const lines: string[] = [];
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = streams.exec(raw); m; m = streams.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue; // Bilddaten o. Ä.
    }
    const ops = /\[((?:<[0-9a-fA-F]*>|[^\]])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
    for (let op = ops.exec(body); op; op = ops.exec(body)) {
      const hex = op[1] !== undefined ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('') : op[2]!;
      lines.push([...Buffer.from(hex, 'hex')].map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join(''));
    }
  }
  return lines;
}

/** PDF abrufen (angemeldet als Test-Service-Token). */
export async function fetchPdf(baseUrl: string, path: string): Promise<{ status: number; type: string | null; disposition: string | null; body: Buffer }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders });
  const body = Buffer.from(await response.arrayBuffer());
  // Zum Ansehen: PDF_DUMP_DIR=… schreibt jedes erfolgreich abgerufene PDF in diesen Ordner.
  const dump = process.env['PDF_DUMP_DIR'];
  if (dump && response.ok) {
    mkdirSync(dump, { recursive: true });
    writeFileSync(join(dump, `${path.split('?')[0]!.split('/').slice(-2).join('-')}.pdf`), body);
  }
  return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), body };
}
