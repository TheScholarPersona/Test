import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';

/** Maße in Punkt (1/72 Zoll). */
export const A4: [number, number] = [595.28, 841.89];
export const A6: [number, number] = [297.64, 419.53];

export type Pdf = PDFKit.PDFDocument;

/** Baut ein PDF mit Standardschrift (Helvetica, WinAnsi – deckt Umlaute ab) und liefert es als Buffer. */
export async function renderPdf(title: string, size: [number, number], draw: (doc: Pdf) => Promise<void>): Promise<Buffer> {
  const doc = new PDFDocument({ size, margin: 24, autoFirstPage: true, info: { Title: title, Producer: 'WMS', Creator: 'WMS' }, lang: 'de-DE' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font('Helvetica');
  await draw(doc);
  doc.end();
  return done;
}

/**
 * Interner Barcode (Code 128) mit Klartext darunter. Es werden ausschließlich die eigenen Kennungen
 * des WMS kodiert (TU-Barcode, Sendungsnummer, Auftrag) – keine SSCC/GS1-Inhalte.
 */
export async function barcode(doc: Pdf, text: string, x: number, y: number, width: number, height: number): Promise<void> {
  const png = await bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 12, includetext: true, textxalign: 'center', textsize: 10 });
  doc.image(png, x, y, { fit: [width, height], align: 'center', valign: 'center' });
}

export function heading(doc: Pdf, text: string, size = 16): void {
  doc.font('Helvetica-Bold').fontSize(size).text(text).font('Helvetica').fontSize(10).moveDown(0.3);
}

/** Zeile „Bezeichnung: Wert“. */
export function field(doc: Pdf, label: string, value: string | null | undefined): void {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value || '–');
}

export interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/** Einfache Tabelle mit Kopfzeile und Seitenumbruch. */
export function table(doc: Pdf, columns: Column[], rows: string[][]): void {
  const left = doc.page.margins.left;
  const drawRow = (cells: string[], bold: boolean) => {
    const y = doc.y;
    const height = Math.max(...cells.map((c, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').heightOfString(c || ' ', { width: columns[i]!.width - 4 })));
    if (y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      return drawRow(cells, bold);
    }
    let x = left;
    cells.forEach((c, i) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(c || ' ', x + 2, y, { width: columns[i]!.width - 4, align: columns[i]!.align ?? 'left' });
      x += columns[i]!.width;
    });
    doc.y = y + height + 3;
    doc.moveTo(left, doc.y - 1.5).lineTo(x, doc.y - 1.5).lineWidth(0.3).strokeColor('#999999').stroke();
    doc.x = left;
  };
  drawRow(columns.map((c) => c.title), true);
  for (const r of rows) drawRow(r, false);
  doc.font('Helvetica');
}

export const quantity = (q: { amount: string; unit: string }) => `${q.amount} ${q.unit}`;
export const de = (d: Date | null | undefined) => (d ? d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '–');
export const addressLines = (a: { name?: string | null; street: string | null; postalCode: string | null; city: string | null; country: string | null }) =>
  [a.name, a.street, [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter((x): x is string => Boolean(x));
