import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Quantity } from '@wms/shared';
import { DomainError, NotFoundError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { InventoryService, type Product, type ShippedContent } from '../../inventory/index.js';
import type { Location } from '../../layout/index.js';
import { OutboundService } from '../../outbound/index.js';
import { PartnerService } from '../../partner/index.js';
import { type LoadedShipment, ShipmentService } from '../../shipping/index.js';
import { TransportUnitService } from '../../transport/index.js';
import { A4, A6, addressLines, barcode, de, field, heading, quantity, renderPdf, table } from './pdf.js';

export interface PdfFile {
  filename: string;
  content: Buffer;
}

type Content = ShippedContent & { description?: string };

/**
 * Dokumente als PDF: Paletten- und Versandetiketten, Pickliste, Lieferschein und Ladeliste. Barcodes
 * sind interne Kennungen des WMS (Code 128). Die Dokumente lesen nur; sie ändern keinen Zustand.
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly em: EntityManager,
    private readonly units: TransportUnitService,
    private readonly inventory: InventoryService,
    private readonly outbound: OutboundService,
    private readonly shipments: ShipmentService,
    private readonly partners: PartnerService,
  ) {}

  /** Palettenetikett (A6): TU-Barcode, Typ, Platz und aktueller Inhalt. */
  async unitLabel(code: string): Promise<PdfFile> {
    const unit = await this.units.get(code);
    const contents = (await this.inventory.contentsOf(this.em, [code])).get(code) ?? [];
    const location = unit.location as Location;
    const content = await renderPdf(`Palettenetikett ${code}`, A6, async (doc) => {
      heading(doc, 'Palettenetikett', 14);
      await barcode(doc, code, 24, doc.y, A6[0] - 48, 90);
      doc.y += 98;
      field(doc, 'TU-Typ', (unit.type as { code: string }).code);
      field(doc, 'Platz', location.erpCode ?? location.locationId);
      doc.moveDown(0.5);
      this.contentsTable(doc, contents, A6[0] - 48);
      doc.moveDown(0.5).fontSize(7).fillColor('#555555').text(`Gedruckt ${de(new Date())}`).fillColor('black');
    });
    return { filename: `palettenetikett-${safe(code)}.pdf`, content };
  }

  /** Versandetiketten (A6), eine Seite je TU der Sendung: Empfänger, Spediteur, Sendung und Packstück. */
  async shippingLabels(number: string, only?: string): Promise<PdfFile> {
    const loaded = await this.shipments.get(number);
    const { shipment } = loaded;
    const units = only ? loaded.units.filter((u) => u.barcode === only) : loaded.units;
    if (only && !units.length) throw new NotFoundError('UNIT_NOT_IN_SHIPMENT', `TU ${only} gehört nicht zur Sendung ${number}`, { number, barcode: only });
    if (!units.length) throw new DomainError('rule-violation', 'SHIPMENT_EMPTY', `Sendung ${number} hat keine TUs`, { number });
    const carrier = await this.partnerName(shipment.carrierCode);
    const content = await renderPdf(`Versandetiketten ${number}`, A6, async (doc) => {
      for (const [i, unit] of units.entries()) {
        if (i > 0) doc.addPage();
        heading(doc, 'Versandetikett', 14);
        doc.fontSize(8).text('Empfänger').fontSize(12).font('Helvetica-Bold');
        for (const line of addressLines(shipTo(loaded))) doc.text(line);
        doc.font('Helvetica').fontSize(10).moveDown(0.5);
        field(doc, 'Auftrag', shipment.orderId);
        field(doc, 'Spediteur', carrier);
        field(doc, 'Packstück', `${loaded.units.indexOf(unit) + 1} von ${loaded.units.length}`);
        doc.moveDown(0.3).fontSize(8).text('Sendung');
        await barcode(doc, number, 24, doc.y, A6[0] - 48, 60);
        doc.y += 66;
        doc.fontSize(8).text('Packstück (TU)');
        await barcode(doc, unit.barcode, 24, doc.y, A6[0] - 48, 60);
        doc.fontSize(10);
      }
    });
    return { filename: `versandetiketten-${safe(number)}${only ? `-${safe(only)}` : ''}.pdf`, content };
  }

  /** Pickliste (A4): offene Picks eines Auftrags in Platzreihenfolge mit Kontrollfeld. */
  async pickList(orderId: string): Promise<PdfFile> {
    const { order, picks } = await this.outbound.get(orderId);
    const open = picks.filter((p) => p.state === 'OPEN').sort((a, b) => a.locationCoordinate.localeCompare(b.locationCoordinate) || a.barcode.localeCompare(b.barcode));
    const skus = open.map((p) => ((p.line as { product: Product }).product as Product).sku);
    const descriptions = await this.inventory.descriptionsOf(this.em, skus);
    const target = order.target as Location | null;
    const content = await renderPdf(`Pickliste ${orderId}`, A4, async (doc) => {
      heading(doc, `Pickliste ${orderId}`);
      await barcode(doc, orderId, doc.page.width - 224, 24, 200, 50);
      field(doc, 'Kunde', [order.customerCode, order.shipToName ?? order.customer].filter(Boolean).join(' – '));
      field(doc, 'Ziel / Packplatz', target ? (target.erpCode ?? target.locationId) : order.targetCoordinate);
      field(doc, 'Priorität', order.priority);
      field(doc, 'Gedruckt', de(new Date()));
      doc.moveDown(0.8);
      if (!open.length) {
        doc.text('Keine offenen Picks.');
        return;
      }
      table(
        doc,
        [
          { title: 'Platz', width: 130 },
          { title: 'TU', width: 90 },
          { title: 'SKU', width: 80 },
          { title: 'Beschreibung', width: 130 },
          { title: 'Menge', width: 65, align: 'right' },
          { title: 'erledigt', width: 50, align: 'center' },
        ],
        open.map((p, i) => {
          const line = p.line as { unitCode: string };
          return [p.locationCoordinate, p.barcode, skus[i]!, descriptions.get(skus[i]!) ?? '', quantity({ amount: normalizeDecimal(p.quantity), unit: line.unitCode }), '[   ]'];
        }),
      );
    });
    return { filename: `pickliste-${safe(orderId)}.pdf`, content };
  }

  /** Lieferschein (A4): Empfänger, Sendung und Positionen je Produkt und Charge, darunter die Packstücke. */
  async deliveryNote(number: string): Promise<PdfFile> {
    const loaded = await this.shipments.get(number);
    const { shipment } = loaded;
    const contents = await this.unitContents(loaded);
    const carrier = await this.partnerName(shipment.carrierCode);
    const lines = aggregate([...contents.values()].flat());
    const descriptions = await this.inventory.descriptionsOf(this.em, lines.map((l) => l.sku));
    const content = await renderPdf(`Lieferschein ${number}`, A4, async (doc) => {
      heading(doc, 'Lieferschein', 18);
      await barcode(doc, number, doc.page.width - 224, 24, 200, 50);
      doc.fontSize(8).text('Empfänger').fontSize(11);
      for (const line of addressLines(shipTo(loaded))) doc.text(line);
      doc.fontSize(10).moveDown(0.8);
      field(doc, 'Lieferschein-Nr.', number);
      field(doc, 'Auftrag', shipment.orderId);
      field(doc, 'Kundennummer', shipment.customerCode);
      field(doc, 'Spediteur', carrier);
      field(doc, 'Datum', de(shipment.shippedAt ?? new Date()));
      if (shipment.state !== 'SHIPPED') field(doc, 'Hinweis', `Sendung ist ${shipment.state} – Inhalt nach aktuellem Bestand`);
      doc.moveDown(0.8);
      table(
        doc,
        [
          { title: 'Pos.', width: 35, align: 'right' },
          { title: 'SKU', width: 90 },
          { title: 'Beschreibung', width: 170 },
          { title: 'Charge', width: 70 },
          { title: 'MHD', width: 70 },
          { title: 'Menge', width: 110, align: 'right' },
        ],
        lines.map((l, i) => [String(i + 1), l.sku, descriptions.get(l.sku) ?? '', l.lot ?? '', l.bestBefore ?? '', quantity(l.quantity)]),
      );
      doc.moveDown(0.8);
      heading(doc, `Packstücke (${loaded.units.length})`, 12);
      table(
        doc,
        [
          { title: 'Nr.', width: 35, align: 'right' },
          { title: 'TU', width: 140 },
          { title: 'Inhalt', width: 370 },
        ],
        loaded.units.map((u, i) => [String(i + 1), u.barcode, (contents.get(u.barcode) ?? []).map((c) => `${quantity(c.quantity)} ${c.sku}${c.lot ? ` (${c.lot})` : ''}`).join(', ')]),
      );
    });
    return { filename: `lieferschein-${safe(number)}.pdf`, content };
  }

  /** Ladeliste (A4): alle TUs der Sendung mit Inhalt, Ladekontrolle und Feld zum Abhaken. */
  async loadingList(number: string): Promise<PdfFile> {
    const loaded = await this.shipments.get(number);
    const { shipment } = loaded;
    const contents = await this.unitContents(loaded);
    const carrier = await this.partnerName(shipment.carrierCode);
    const content = await renderPdf(`Ladeliste ${number}`, A4, async (doc) => {
      heading(doc, `Ladeliste ${number}`);
      await barcode(doc, number, doc.page.width - 224, 24, 200, 50);
      field(doc, 'Auftrag', shipment.orderId);
      field(doc, 'Spediteur', carrier);
      field(doc, 'Empfänger', addressLines(shipTo(loaded)).join(', '));
      field(doc, 'Zustand', shipment.state);
      field(doc, 'Gedruckt', de(new Date()));
      doc.moveDown(0.8);
      table(
        doc,
        [
          { title: 'Nr.', width: 35, align: 'right' },
          { title: 'TU', width: 120 },
          { title: 'Inhalt', width: 210 },
          { title: 'verladen', width: 130 },
          { title: 'Kontrolle', width: 50, align: 'center' },
        ],
        loaded.units.map((u, i) => [
          String(i + 1),
          u.barcode,
          (contents.get(u.barcode) ?? []).map((c) => `${quantity(c.quantity)} ${c.sku}`).join(', '),
          u.loaded ? `${de(u.loadedAt)}${u.loadedBy ? ` (${u.loadedBy})` : ''}` : 'nein',
          '[   ]',
        ]),
      );
      doc.moveDown(2).text('Fahrer / Spediteur: ______________________________     Unterschrift: ______________________________');
    });
    return { filename: `ladeliste-${safe(number)}.pdf`, content };
  }

  // ---------------------------------------------------------------------------

  private contentsTable(doc: PDFKit.PDFDocument, contents: Content[], width: number): void {
    if (!contents.length) {
      doc.text('Leer');
      return;
    }
    table(
      doc,
      [
        { title: 'SKU', width: width * 0.3 },
        { title: 'Charge / MHD', width: width * 0.38 },
        { title: 'Menge', width: width * 0.32, align: 'right' },
      ],
      contents.map((c) => [c.sku, [c.lot, c.bestBefore].filter(Boolean).join(' / '), quantity(c.quantity)]),
    );
  }

  /** Inhalt je TU: nach dem Warenausgang aus der Historie der Sendung, sonst aus dem aktuellen Bestand. */
  private async unitContents(loaded: LoadedShipment): Promise<Map<string, Content[]>> {
    if (loaded.shipment.state === 'SHIPPED') return new Map(loaded.units.map((u) => [u.barcode, u.contents ?? []]));
    return this.inventory.contentsOf(this.em, loaded.units.map((u) => u.barcode));
  }

  private async partnerName(code: string | null | undefined): Promise<string | null> {
    if (!code) return null;
    try {
      const partner = await this.partners.get(code);
      return `${partner.name} (${code})`;
    } catch {
      return code;
    }
  }
}

function shipTo({ shipment: s }: LoadedShipment) {
  return { name: s.shipToName ?? null, street: s.shipToStreet ?? null, postalCode: s.shipToPostalCode ?? null, city: s.shipToCity ?? null, country: s.shipToCountry ?? null };
}

/** Positionen je Produkt, Charge und MHD zusammenfassen. */
function aggregate(contents: Content[]): Content[] {
  const byKey = new Map<string, Content>();
  for (const c of contents) {
    const key = `${c.sku}|${c.lot ?? ''}|${c.bestBefore ?? ''}|${c.quantity.unit}`;
    const seen = byKey.get(key);
    if (seen) seen.quantity = Quantity.of(seen.quantity.amount, seen.quantity.unit).add(Quantity.of(c.quantity.amount, c.quantity.unit)).toDto();
    else byKey.set(key, { ...c, quantity: { ...c.quantity } });
  }
  return [...byKey.values()].sort((a, b) => a.sku.localeCompare(b.sku) || (a.lot ?? '').localeCompare(b.lot ?? ''));
}

/** Für Dateinamen: nur unkritische Zeichen. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
