import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ProductCreatedEvent,
  ProductUpdatedEvent,
  Quantity,
  type QuantityDto,
  StockCorrectedEvent,
  StockIssuedEvent,
  StockReceivedEvent,
  StockReservationReleasedEvent,
  StockReservedEvent,
  StockTransferredEvent,
} from '@wms/shared';
import { ConflictError, DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { LocationLookup } from '../../layout/index.js';
import { type TransportUnit, TransportUnitRemovalPolicy, TransportUnitService } from '../../transport/index.js';
import {
  type BOOKING_TYPES,
  Product,
  ProductUnit,
  StockBooking,
  StockCount,
  StockItem,
  StockReservation,
} from '../entities/inventory.entities.js';
import type {
  CreateProduct,
  IssueInput,
  JournalQuery,
  ProductUnitsInput,
  ReservationQuery,
  ReserveInput,
  StockCorrection,
  StockQuery,
  SummaryQuery,
  TransferInput,
  UpdateProduct,
} from '../http/schemas.js';

export interface ReceiveInput {
  product: Product;
  unit: TransportUnit;
  quantity: Quantity;
  lot: string | null;
  /** Mindesthaltbarkeit als ISO-Datum (JJJJ-MM-TT). */
  bestBefore: string | null;
  reference: string;
}

export interface TransferResult {
  transferId: string;
  from: StockItem;
  to: StockItem;
  fromRemoved: boolean;
}

/** Inhalt einer TU zum Zeitpunkt des Warenausgangs. */
export interface ShippedContent {
  sku: string;
  quantity: QuantityDto;
  lot: string | null;
  bestBefore: string | null;
}

export interface SummaryRow {
  sku: string;
  location: { id: string; locationId: string } | null;
  unit: string;
  onHand: string;
  reserved: string;
  available: string;
  items: number;
  units: number;
}

type BookingType = (typeof BOOKING_TYPES)[number];

const productSnapshot = (p: Product) => ({
  sku: p.sku,
  description: p.description,
  baseUnit: p.baseUnit,
  overdeliveryAllowed: p.overdeliveryAllowed,
});
const isoDate = (d: Date | string | null | undefined): string | null =>
  d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const SCALE = 3;

const onHandOf = (item: StockItem) => Quantity.of(normalizeDecimal(item.quantity), item.unitCode);
const reservedOf = (item: StockItem) => Quantity.of(normalizeDecimal(item.reserved), item.unitCode);
export const availableOf = (item: StockItem) => onHandOf(item).subtract(reservedOf(item));

/**
 * Bestandsführung: Produkte mit Einheiten, Bestand je Transporteinheit,
 * Buchungen (Zugang, Abgang, Umbuchung, Korrektur), Reservierungen.
 *
 * Jede Buchung sperrt zuerst die betroffenen TU-Zeilen in fester Reihenfolge
 * (nach id). Damit laufen gleichzeitige Buchungen auf dieselbe TU nacheinander
 * und können sich nicht gegenseitig blockieren; dort wird auch die
 * Inventursperre geprüft.
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly units: TransportUnitService,
    private readonly unitRemoval: TransportUnitRemovalPolicy,
  ) {}

  /** TUs mit Bestand oder laufender Inventur dürfen nicht gelöscht werden. */
  onModuleInit(): void {
    this.unitRemoval.register('stock', async (unit, em) => {
      const items = await em.count(StockItem, { unit: unit.id });
      return items > 0 ? `${items} Bestandsposten auf der TU` : null;
    });
    this.unitRemoval.register('stock-count', async (unit, em) => {
      const open = await em.findOne(StockCount, {
        unit: unit.id,
        state: { $in: ['OPEN', 'COUNTED'] },
      });
      return open ? `Laufende Inventur ${open.number}` : null;
    });
  }

  // --- Produkte ---------------------------------------------------------------

  listProducts(limit: number, offset: number): Promise<[Product[], number]> {
    return this.em.findAndCount(Product, {}, { orderBy: { sku: 'asc' }, limit, offset });
  }

  getProduct(sku: string): Promise<Product> {
    return this.productIn(this.em, sku);
  }

  async productIn(em: EntityManager, sku: string): Promise<Product> {
    const product = await em.findOne(Product, { sku });
    if (!product) {
      throw new NotFoundError('PRODUCT_NOT_FOUND', `Produkt [${sku}] existiert nicht`, { sku });
    }
    return product;
  }

  /** Alternative Einheiten je Produkt (für die Ausgabe). */
  async unitsOf(products: Product[]): Promise<Map<string, { unit: string; factor: string }[]>> {
    const rows = products.length
      ? await this.em.find(ProductUnit, { product: { $in: products.map((p) => p.id) } }, { orderBy: { unitCode: 'asc' } })
      : [];
    const result = new Map<string, { unit: string; factor: string }[]>(products.map((p) => [p.id, []]));
    for (const row of rows) result.get((row.product as Product).id)?.push({ unit: row.unitCode, factor: normalizeDecimal(row.factor) });
    return result;
  }

  createProduct(input: CreateProduct): Promise<Product> {
    return this.em.transactional(async (tx) => {
      if ((await tx.count(Product, { sku: input.sku })) > 0) {
        throw new ConflictError('PRODUCT_EXISTS', `Produkt [${input.sku}] existiert bereits`, { sku: input.sku });
      }
      const { units, ...fields } = input;
      const product = tx.create(Product, { id: randomUUID(), ...fields });
      this.writeUnits(tx, product, units);
      this.outbox.record(tx, ProductCreatedEvent, productSnapshot(product));
      return product;
    });
  }

  updateProduct(sku: string, input: UpdateProduct): Promise<Product> {
    return this.em.transactional(async (tx) => {
      const product = await this.productIn(tx, sku);
      if (input.baseUnit !== undefined && input.baseUnit !== product.baseUnit && (await tx.count(StockItem, { product })) > 0) {
        throw new RuleViolationError(
          'PRODUCT_UNIT_IN_USE',
          `Die Basiseinheit von [${sku}] kann nicht geändert werden, solange Bestand existiert`,
          { sku },
        );
      }
      if (input.baseUnit !== undefined && (await tx.count(ProductUnit, { product, unitCode: input.baseUnit }))) {
        throw new DomainError('invalid', 'UNIT_CONFLICT', `${input.baseUnit} ist bereits als alternative Einheit definiert`, {
          unit: input.baseUnit,
        });
      }
      if (input.description !== undefined) product.description = input.description;
      if (input.baseUnit !== undefined) product.baseUnit = input.baseUnit;
      if (input.overdeliveryAllowed !== undefined) product.overdeliveryAllowed = input.overdeliveryAllowed;
      this.outbox.record(tx, ProductUpdatedEvent, productSnapshot(product));
      return product;
    });
  }

  /** Ersetzt die alternativen Einheiten. Bestand bleibt unberührt, er wird immer in der Basiseinheit geführt. */
  replaceUnits(sku: string, input: ProductUnitsInput): Promise<Product> {
    return this.em.transactional(async (tx) => {
      const product = await this.productIn(tx, sku);
      await tx.nativeDelete(ProductUnit, { product: product.id });
      this.writeUnits(tx, product, input.units);
      product.updatedAt = new Date();
      this.outbox.record(tx, ProductUpdatedEvent, productSnapshot(product));
      return product;
    });
  }

  // --- Abfragen -----------------------------------------------------------------

  async listStock(query: StockQuery): Promise<[StockItem[], number]> {
    const where: FilterQuery<StockItem> = {};
    const unitWhere: Record<string, unknown> = {};
    if (query.barcode) unitWhere['barcode'] = query.barcode;
    if (query.location) unitWhere['location'] = query.location;
    if (query.group)
      unitWhere['location'] = {
        $in: (await this.lookup.inGroup(this.em.fork(), query.group, true)).map((l) => l.id),
      };
    if (Object.keys(unitWhere).length) where.unit = unitWhere;
    if (query.sku) where.product = { sku: query.sku };
    if (query.lot) where.lot = query.lot;
    return this.em.findAndCount(StockItem, where, {
      populate: ['product', 'unit', 'unit.location'],
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
  }

  listJournal(query: JournalQuery): Promise<[StockBooking[], number]> {
    const where: FilterQuery<StockBooking> = {};
    if (query.sku) where.sku = query.sku;
    if (query.barcode) where.barcode = query.barcode;
    if (query.reference) where.reference = query.reference;
    return this.em.findAndCount(StockBooking, where, {
      orderBy: { createdAt: 'desc', id: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
  }

  /** Summen je Produkt bzw. je Platz und Produkt, mit Reservierung und verfügbarer Menge. */
  async summary(query: SummaryQuery): Promise<{ items: SummaryRow[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.sku) {
      where.push('p.sku = ?');
      params.push(query.sku);
    }
    if (query.group) {
      const ids = (await this.lookup.inGroup(this.em.fork(), query.group, true)).map((l) => l.id);
      if (ids.length === 0) return { items: [], total: 0 };
      where.push(`tu.location_id in (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    const byLocation = query.by === 'location';
    const keys = byLocation ? 'l.id, l.location_id, p.sku, si.unit_code' : 'p.sku, si.unit_code';
    const sql =
      `select ${byLocation ? 'l.id as loc_id, l.location_id as loc_coord, ' : ''}p.sku, si.unit_code, ` +
      'sum(si.quantity)::text as on_hand, sum(si.reserved)::text as reserved, count(*)::int as items, count(distinct si.unit_id)::int as units, ' +
      'count(*) over ()::int as total ' +
      'from stock_item si join product p on p.id = si.product_id join transport_unit tu on tu.id = si.unit_id join location l on l.id = tu.location_id ' +
      (where.length ? `where ${where.join(' and ')} ` : '') +
      `group by ${keys} order by ${byLocation ? 'l.location_id, ' : ''}p.sku limit ? offset ?`;
    const rows = await this.em.getConnection().execute<Record<string, unknown>[]>(sql, [...params, query.limit, query.offset]);
    const items = rows.map((r) => {
      const unit = String(r['unit_code']);
      const onHand = Quantity.of(normalizeDecimal(String(r['on_hand'])), unit);
      const reserved = Quantity.of(normalizeDecimal(String(r['reserved'])), unit);
      return {
        sku: String(r['sku']),
        location: byLocation ? { id: String(r['loc_id']), locationId: String(r['loc_coord']) } : null,
        unit,
        onHand: onHand.amount,
        reserved: reserved.amount,
        available: onHand.subtract(reserved).amount,
        items: Number(r['items']),
        units: Number(r['units']),
      };
    });
    return { items, total: rows.length ? Number(rows[0]!['total']) : 0 };
  }

  listReservations(query: ReservationQuery): Promise<[StockReservation[], number]> {
    const where: FilterQuery<StockReservation> = {};
    if (query.reference) where.reference = query.reference;
    if (query.barcode || query.sku) {
      where.item = {
        ...(query.barcode ? { unit: { barcode: query.barcode } } : {}),
        ...(query.sku ? { product: { sku: query.sku } } : {}),
      };
    }
    return this.em.findAndCount(StockReservation, where, {
      populate: ['item', 'item.product', 'item.unit'],
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
  }

  // --- Buchungen ----------------------------------------------------------------

  /**
   * Bestandskorrektur (Inventurdifferenz, Bruch, …) mit Grund. Negativer
   * Bestand und Unterschreiten der Reservierung sind nicht zulässig; fällt der
   * Posten auf 0, wird er entfernt.
   */
  correct(id: string, input: StockCorrection): Promise<{ booking: StockBooking; onHand: Quantity; removed: boolean }> {
    return this.em.transactional(async (tx) => {
      const item = await this.lockItem(tx, id);
      const product = item.product as Product;
      const delta = await this.toBase(tx, product, input.delta, {
        allowNegative: true,
      });
      return this.correctIn(tx, item, delta, `correction:${input.reason}`, input.reason);
    });
  }

  /** Korrektur innerhalb einer Transaktion; die TU muss bereits gesperrt sein (z. B. Inventurabschluss). */
  async correctIn(
    tx: EntityManager,
    item: StockItem,
    delta: Quantity,
    reference: string,
    reason: string,
  ): Promise<{ booking: StockBooking; onHand: Quantity; removed: boolean }> {
    const product = item.product as Product;
    const unit = item.unit as TransportUnit;
    const { onHand, removed } = this.applyDelta(tx, item, delta);
    const booking = this.book(tx, 'CORRECTION', item, delta, reference);
    this.outbox.record(tx, StockCorrectedEvent, {
      bookingId: booking.id,
      sku: product.sku,
      barcode: unit.barcode,
      delta: delta.toDto(),
      onHand: onHand.toDto(),
      reason,
    });
    return { booking, onHand, removed };
  }

  /**
   * Abgang (Verbrauch, Versand, Kommissionierung). Ohne Reservierung höchstens
   * die verfügbare Menge; mit `reservationId` wird die Reservierung verbraucht.
   */
  issue(id: string, input: IssueInput): Promise<{ booking: StockBooking; onHand: Quantity; removed: boolean }> {
    return this.em.transactional((tx) => this.issueIn(tx, id, input));
  }

  /** Wie `issue`, innerhalb der Transaktion des Aufrufers (z. B. Pick-Quittung). */
  async issueIn(tx: EntityManager, id: string, input: IssueInput): Promise<{ booking: StockBooking; onHand: Quantity; removed: boolean }> {
    {
      const item = await this.lockItem(tx, id);
      const product = item.product as Product;
      const unit = item.unit as TransportUnit;
      const quantity = await this.toBase(tx, product, input.quantity);
      const reservation = input.reservationId ? await this.consumeReservation(tx, item, input.reservationId, quantity) : null;
      const { onHand, removed } = this.applyDelta(tx, item, quantity.negate());
      const booking = this.book(tx, 'ISSUE', item, quantity.negate(), input.reference);
      this.outbox.record(tx, StockIssuedEvent, {
        bookingId: booking.id,
        sku: product.sku,
        barcode: unit.barcode,
        quantity: quantity.toDto(),
        onHand: onHand.toDto(),
        reference: input.reference,
        reservationId: reservation?.id ?? null,
      });
      return { booking, onHand, removed };
    }
  }

  /** Aktueller Inhalt je TU (z. B. für Etiketten und Lieferscheine), mit Produktbeschreibung. */
  async contentsOf(em: EntityManager, barcodes: string[]): Promise<Map<string, (ShippedContent & { description: string })[]>> {
    const result = new Map<string, (ShippedContent & { description: string })[]>(barcodes.map((b) => [b, []]));
    if (!barcodes.length) return result;
    const items = await em.find(StockItem, { unit: { barcode: { $in: barcodes } } }, { populate: ['product', 'unit'], orderBy: { createdAt: 'asc', id: 'asc' } });
    for (const item of items) {
      const product = item.product as Product;
      result.get((item.unit as TransportUnit).barcode)?.push({ sku: product.sku, description: product.description, quantity: onHandOf(item).toDto(), lot: item.lot ?? null, bestBefore: isoDate(item.bestBefore) });
    }
    return result;
  }

  /** Produktbeschreibungen zu SKUs. */
  async descriptionsOf(em: EntityManager, skus: string[]): Promise<Map<string, string>> {
    const products = skus.length ? await em.find(Product, { sku: { $in: [...new Set(skus)] } }) : [];
    return new Map(products.map((p) => [p.sku, p.description]));
  }

  /** Liegt Bestand auf der TU? */
  async hasStockIn(em: EntityManager, unitId: string): Promise<boolean> {
    return (await em.count(StockItem, { unit: unitId })) > 0;
  }

  /** Bestand eines Postens innerhalb der Transaktion des Aufrufers. */
  async stockItemIn(tx: EntityManager, id: string): Promise<{ quantity: Quantity; reserved: Quantity }> {
    const item = await this.peekItem(tx, id);
    return { quantity: onHandOf(item), reserved: reservedOf(item) };
  }

  /**
   * Verbraucht `quantity` einer Reservierung des Postens (Reservierung sinkt, Bestand bleibt) –
   * vor einem Abgang oder einer Umbuchung, oder beim Packen einer ganzen TU an Ort und Stelle.
   */
  async consumeReservationIn(tx: EntityManager, itemId: string, reservationId: string, quantity: Quantity): Promise<void> {
    const item = await this.lockItem(tx, itemId);
    await this.consumeReservation(tx, item, reservationId, quantity);
  }

  private async consumeReservation(tx: EntityManager, item: StockItem, reservationId: string, quantity: Quantity): Promise<StockReservation> {
    const product = item.product as Product;
    const unit = item.unit as TransportUnit;
    const reservation = await tx.findOne(StockReservation, { id: reservationId, item: item.id });
    if (!reservation) {
      throw new NotFoundError('RESERVATION_NOT_FOUND', `Reservierung [${reservationId}] gehört nicht zu diesem Posten`, { reservationId });
    }
    const reserved = Quantity.of(normalizeDecimal(reservation.quantity), reservation.unitCode);
    if (quantity.compareTo(reserved) > 0) {
      throw new RuleViolationError('EXCEEDS_RESERVATION', `Menge ${quantity.toString()} übersteigt die Reservierung ${reserved.toString()}`, {
        quantity: quantity.amount,
        reserved: reserved.amount,
      });
    }
    this.changeReserved(item, quantity.negate());
    const rest = reserved.subtract(quantity);
    if (rest.isZero()) tx.remove(reservation);
    else reservation.quantity = rest.amount;
    this.outbox.record(tx, StockReservationReleasedEvent, { reservationId: reservation.id, sku: product.sku, barcode: unit.barcode, quantity: quantity.toDto(), consumed: true });
    return reservation;
  }

  /**
   * Umbuchung einer Teilmenge auf eine andere TU (z. B. Umpacken). Charge und
   * MHD bleiben erhalten; auf der Ziel-TU wird gleichartiger Bestand zusammengeführt.
   */
  transfer(id: string, input: TransferInput): Promise<TransferResult> {
    return this.em.transactional(async (tx) => {
      const peek = await this.peekItem(tx, id);
      const target = await this.units.loadIn(tx, input.to);
      const quantity = await this.toBase(tx, peek.product as Product, input.quantity);
      return this.transferIn(tx, id, { to: target, quantity, reference: input.reference });
    });
  }

  /**
   * Wie `transfer`, innerhalb der Transaktion des Aufrufers (z. B. Packen beim Pick). Mit `reservationId`
   * wird die Menge zuerst aus der Reservierung genommen; `quantity` ist bereits in der Basiseinheit.
   */
  async transferIn(tx: EntityManager, id: string, input: { to: TransportUnit; quantity: Quantity; reference?: string | undefined; reservationId?: string | undefined }): Promise<TransferResult> {
    const peek = await this.peekItem(tx, id);
    const target = input.to;
    const sourceUnit = peek.unit as TransportUnit;
    if (target.id === sourceUnit.id) {
      throw new RuleViolationError('SAME_UNIT', `Quelle und Ziel sind dieselbe TU ${target.barcode}`, { barcode: target.barcode });
    }
    await this.lockUnits(tx, [sourceUnit.id, target.id]);
    const item = await this.reloadItem(tx, id);
    const product = item.product as Product;
    const quantity = input.quantity;
    const transferId = randomUUID();
    const reference = input.reference ?? `transfer:${transferId}`;
    const lot = item.lot ?? null;
    const bestBefore = isoDate(item.bestBefore);
    if (input.reservationId) await this.consumeReservation(tx, item, input.reservationId, quantity);
    const { removed } = this.applyDelta(tx, item, quantity.negate());
    this.book(tx, 'TRANSFER_OUT', item, quantity.negate(), reference, sourceUnit.barcode);
    const to = await this.addTo(tx, product, target, quantity, lot, bestBefore);
    this.book(tx, 'TRANSFER_IN', to, quantity, reference, target.barcode);
    this.outbox.record(tx, StockTransferredEvent, { transferId, sku: product.sku, from: sourceUnit.barcode, to: target.barcode, quantity: quantity.toDto(), lot, bestBefore, reference });
    return { transferId, from: item, to, fromRemoved: removed };
  }

  /**
   * Warenausgang: bucht den gesamten Bestand einer TU mit der Buchungsart SHIP aus und liefert ihn als
   * Momentaufnahme. Reservierter Bestand blockiert (`STOCK_RESERVED`).
   */
  async shipUnitIn(tx: EntityManager, unit: TransportUnit, reference: string): Promise<ShippedContent[]> {
    await this.lockUnits(tx, [unit.id]);
    await tx.flush();
    const items = await tx.find(StockItem, { unit: unit.id }, { populate: ['product', 'unit'], refresh: true, orderBy: { createdAt: 'asc', id: 'asc' } });
    const contents: ShippedContent[] = [];
    for (const item of items) {
      const product = item.product as Product;
      const quantity = onHandOf(item);
      const { onHand } = this.applyDelta(tx, item, quantity.negate());
      const booking = this.book(tx, 'SHIP', item, quantity.negate(), reference);
      this.outbox.record(tx, StockIssuedEvent, { bookingId: booking.id, sku: product.sku, barcode: unit.barcode, quantity: quantity.toDto(), onHand: onHand.toDto(), reference, reservationId: null });
      contents.push({ sku: product.sku, quantity: quantity.toDto(), lot: item.lot ?? null, bestBefore: isoDate(item.bestBefore) });
    }
    return contents;
  }

  /** Reserviert verfügbaren Bestand eines Postens. */
  reserve(id: string, input: ReserveInput): Promise<StockReservation> {
    return this.em.transactional((tx) => this.reserveIn(tx, id, input));
  }

  /** Wie `reserve`, innerhalb der Transaktion des Aufrufers (z. B. Zuteilung eines Auslagerauftrags). */
  async reserveIn(tx: EntityManager, id: string, input: ReserveInput): Promise<StockReservation> {
    {
      const item = await this.lockItem(tx, id);
      const product = item.product as Product;
      const quantity = await this.toBase(tx, product, input.quantity);
      const available = availableOf(item);
      if (quantity.compareTo(available) > 0) {
        throw new RuleViolationError('STOCK_NOT_AVAILABLE', `Verfügbar sind ${available.toString()}, angefragt ${quantity.toString()}`, {
          available: available.amount,
          requested: quantity.amount,
        });
      }
      this.changeReserved(item, quantity);
      const reservation = tx.create(StockReservation, {
        id: randomUUID(),
        item,
        quantity: quantity.amount,
        unitCode: quantity.unit,
        reference: input.reference,
      });
      this.outbox.record(tx, StockReservedEvent, {
        reservationId: reservation.id,
        sku: product.sku,
        barcode: (item.unit as TransportUnit).barcode,
        quantity: quantity.toDto(),
        reference: input.reference,
      });
      return reservation;
    }
  }

  releaseReservation(reservationId: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      await this.releaseReservationIn(tx, reservationId);
    });
  }

  /** Reservierung aufheben, innerhalb der Transaktion des Aufrufers. Bereits verbrauchte Reservierungen: `false`. */
  async releaseReservationIn(tx: EntityManager, reservationId: string, options: { ignoreMissing?: boolean } = {}): Promise<boolean> {
    {
      const peek = await tx.findOne(StockReservation, { id: reservationId }, { populate: ['item'] });
      if (!peek) {
        if (options.ignoreMissing) return false;
        throw new NotFoundError('RESERVATION_NOT_FOUND', `Reservierung [${reservationId}] existiert nicht`, { reservationId });
      }
      const item = await this.lockItem(tx, (peek.item as StockItem).id);
      await tx.flush(); // eigene, noch nicht geschriebene Änderungen nicht durch refresh verwerfen
      const reservation = await tx.findOneOrFail(StockReservation, { id: reservationId }, { refresh: true });
      const quantity = Quantity.of(normalizeDecimal(reservation.quantity), reservation.unitCode);
      this.changeReserved(item, quantity.negate());
      tx.remove(reservation);
      this.outbox.record(tx, StockReservationReleasedEvent, {
        reservationId,
        sku: (item.product as Product).sku,
        barcode: (item.unit as TransportUnit).barcode,
        quantity: quantity.toDto(),
        consumed: false,
      });
      return true;
    }
  }

  // --- Auslagerung ----------------------------------------------------------------

  /** TU-Ids mit Bestand des Produkts (für das Sperren vor einer Zuteilung). */
  async unitIdsWithStock(em: EntityManager, sku: string): Promise<string[]> {
    const rows = await em
      .getConnection()
      .execute<
        { unit_id: string }[]
      >('select distinct si.unit_id from stock_item si join product p on p.id = si.product_id where p.sku = ? order by si.unit_id', [sku]);
    return rows.map((r) => r.unit_id);
  }

  /** Sperrt TU-Zeilen in fester Reihenfolge, ohne die Inventursperre zu prüfen (die Zuteilung schließt solche TUs als Regel aus). */
  async lockUnitRows(tx: EntityManager, unitIds: string[]): Promise<void> {
    if (unitIds.length === 0) return;
    const ids = [...new Set(unitIds)].sort();
    await tx.execute(`select "id" from "transport_unit" where "id" in (${ids.map(() => '?').join(', ')}) order by "id" for update`, ids);
  }

  /**
   * Bestandsposten eines Produkts mit TU, Platz und TU-Typ (frisch gelesen),
   * dazu die TUs mit laufender Inventur und die Anzahl Posten je TU.
   */
  async allocationCandidates(
    tx: EntityManager,
    sku: string,
    lot?: string,
  ): Promise<{
    items: StockItem[];
    countedUnits: Set<string>;
    itemsPerUnit: Map<string, number>;
  }> {
    await tx.flush(); // eigene, noch nicht geschriebene Änderungen nicht durch refresh verwerfen
    const items = await tx.find(
      StockItem,
      { product: { sku }, ...(lot ? { lot } : {}) },
      {
        populate: ['product', 'unit', 'unit.location'],
        refresh: true,
        orderBy: { createdAt: 'asc', id: 'asc' },
      },
    );
    const unitIds = [...new Set(items.map((i) => (i.unit as TransportUnit).id))];
    const counts = unitIds.length
      ? await tx.find(StockCount, {
          unit: { $in: unitIds },
          state: { $in: ['OPEN', 'COUNTED'] },
        })
      : [];
    const perUnit = unitIds.length
      ? await tx
          .getConnection()
          .execute<
            { unit_id: string; n: number }[]
          >(`select unit_id, count(*)::int as n from stock_item where unit_id in (${unitIds.map(() => '?').join(', ')}) group by unit_id`, unitIds)
      : [];
    return {
      items,
      countedUnits: new Set(counts.map((c) => (c.unit as TransportUnit).id)),
      itemsPerUnit: new Map(perUnit.map((r) => [r.unit_id, Number(r.n)])),
    };
  }

  /**
   * Bucht einen Zugang auf eine TU – innerhalb der Transaktion des Aufrufers.
   * Gleichartiger Bestand (Produkt, Charge, MHD) wird zusammengeführt.
   * Wareneingang bucht in der Basiseinheit (Avis und Erfassung sind darin geführt).
   */
  async receiveIn(tx: EntityManager, input: ReceiveInput): Promise<{ item: StockItem; booking: StockBooking }> {
    const { product, unit, quantity } = input;
    if (quantity.unit !== product.baseUnit) {
      throw new RuleViolationError(
        'UNIT_MISMATCH',
        `Produkt ${product.sku} wird in ${product.baseUnit} geführt, erfasst wurde ${quantity.unit}`,
        {
          sku: product.sku,
          baseUnit: product.baseUnit,
          unit: quantity.unit,
        },
      );
    }
    if (quantity.isZero() || quantity.isNegative()) {
      throw new RuleViolationError('INVALID_QUANTITY', 'Die Menge muss größer als 0 sein', { quantity: quantity.amount });
    }
    await this.lockUnits(tx, [unit.id]);
    const item = await this.addTo(tx, product, unit, quantity, input.lot, input.bestBefore);
    const booking = this.book(tx, 'RECEIPT', item, quantity, input.reference, unit.barcode);
    this.outbox.record(tx, StockReceivedEvent, {
      bookingId: booking.id,
      sku: product.sku,
      barcode: unit.barcode,
      quantity: quantity.toDto(),
      onHand: onHandOf(item).toDto(),
      lot: input.lot,
      bestBefore: isoDate(input.bestBefore),
      reference: input.reference,
    });
    return { item, booking };
  }

  /** Zugang aus einer Inventur (gefundener Bestand); die TU muss gesperrt sein. */
  async foundIn(
    tx: EntityManager,
    product: Product,
    unit: TransportUnit,
    quantity: Quantity,
    lot: string | null,
    bestBefore: string | null,
    reference: string,
    reason: string,
  ): Promise<void> {
    const item = await this.addTo(tx, product, unit, quantity, lot, bestBefore);
    const booking = this.book(tx, 'CORRECTION', item, quantity, reference, unit.barcode);
    this.outbox.record(tx, StockCorrectedEvent, {
      bookingId: booking.id,
      sku: product.sku,
      barcode: unit.barcode,
      delta: quantity.toDto(),
      onHand: onHandOf(item).toDto(),
      reason,
    });
  }

  /**
   * Sperrt die TU-Zeilen in fester Reihenfolge und prüft die Inventursperre.
   * `countId`: diese Inventur darf buchen (Abschluss).
   */
  async lockUnits(tx: EntityManager, unitIds: string[], countId?: string): Promise<void> {
    const ids = [...new Set(unitIds)].sort();
    await tx.execute(`select "id" from "transport_unit" where "id" in (${ids.map(() => '?').join(', ')}) order by "id" for update`, ids);
    const counts = await tx.find(StockCount, {
      unit: { $in: ids },
      state: { $in: ['OPEN', 'COUNTED'] },
      ...(countId ? { id: { $ne: countId } } : {}),
    });
    if (counts.length > 0) {
      throw new ConflictError(
        'COUNT_IN_PROGRESS',
        `Inventur ${counts.map((c) => c.number).join(', ')} läuft; Buchungen auf ${counts.map((c) => c.barcode).join(', ')} sind gesperrt`,
        {
          counts: counts.map((c) => ({ number: c.number, barcode: c.barcode })),
        },
      );
    }
  }

  // --- Hilfen -------------------------------------------------------------------

  /** Menge in die Basiseinheit des Produkts umrechnen (Basiseinheit oder definierte alternative Einheit). */
  async toBase(tx: EntityManager, product: Product, dto: QuantityDto, options: { allowNegative?: boolean } = {}): Promise<Quantity> {
    const given = Quantity.fromDto(dto);
    let base: Quantity;
    if (given.unit === product.baseUnit) {
      base = given;
    } else {
      const unit = await tx.findOne(ProductUnit, {
        product: product.id,
        unitCode: given.unit,
      });
      if (!unit) {
        const known = (await tx.find(ProductUnit, { product: product.id })).map((u) => u.unitCode);
        throw new RuleViolationError(
          'UNIT_MISMATCH',
          `Produkt ${product.sku} kennt die Einheit ${given.unit} nicht (Basis ${product.baseUnit}${known.length ? `, außerdem ${known.join(', ')}` : ''})`,
          {
            sku: product.sku,
            baseUnit: product.baseUnit,
            unit: given.unit,
            units: known,
          },
        );
      }
      base = given.convert(normalizeDecimal(unit.factor), product.baseUnit);
    }
    if (base.isZero() || (base.isNegative() && !options.allowNegative)) {
      throw new RuleViolationError(
        'INVALID_QUANTITY',
        options.allowNegative ? 'Die Menge darf nicht 0 sein' : 'Die Menge muss größer als 0 sein',
        { quantity: given.amount },
      );
    }
    if (base.decimalPlaces() > SCALE) {
      throw new RuleViolationError(
        'INVALID_QUANTITY',
        `${given.toString()} ergibt ${base.toString()}; Bestand wird mit höchstens ${SCALE} Nachkommastellen geführt`,
        { quantity: base.amount },
      );
    }
    return base;
  }

  /** Posten laden, seine TU sperren, dann frisch lesen. */
  private async lockItem(tx: EntityManager, id: string): Promise<StockItem> {
    const peek = await this.peekItem(tx, id);
    await this.lockUnits(tx, [(peek.unit as TransportUnit).id]);
    return this.reloadItem(tx, id);
  }

  private async peekItem(tx: EntityManager, id: string): Promise<StockItem> {
    const item = await tx.findOne(StockItem, { id }, { populate: ['product', 'unit'] });
    if (!item) throw new NotFoundError('STOCK_ITEM_NOT_FOUND', `Bestandsposten [${id}] existiert nicht`, { id });
    return item;
  }

  private async reloadItem(tx: EntityManager, id: string): Promise<StockItem> {
    await tx.flush(); // eigene, noch nicht geschriebene Änderungen nicht durch refresh verwerfen
    const item = await tx.findOne(StockItem, { id }, { populate: ['product', 'unit'], refresh: true });
    if (!item) throw new NotFoundError('STOCK_ITEM_NOT_FOUND', `Bestandsposten [${id}] existiert nicht mehr`, { id });
    return item;
  }

  /** Menge ändern; nie negativ und nie unter die Reservierung. Posten auf 0 wird entfernt. */
  private applyDelta(tx: EntityManager, item: StockItem, delta: Quantity): { onHand: Quantity; removed: boolean } {
    const before = onHandOf(item);
    const onHand = before.add(delta);
    if (onHand.isNegative()) {
      throw new RuleViolationError('STOCK_INSUFFICIENT', `Bestand ${before.toString()} reicht für ${delta.toString()} nicht`, {
        onHand: before.amount,
        delta: delta.amount,
      });
    }
    const reserved = reservedOf(item);
    if (onHand.compareTo(reserved) < 0) {
      throw new RuleViolationError(
        'STOCK_RESERVED',
        `${reserved.toString()} sind reserviert; verfügbar ${before.subtract(reserved).toString()}`,
        {
          onHand: before.amount,
          reserved: reserved.amount,
          delta: delta.amount,
        },
      );
    }
    const removed = onHand.isZero();
    if (removed) tx.remove(item);
    else item.quantity = onHand.amount;
    return { onHand, removed };
  }

  private changeReserved(item: StockItem, delta: Quantity): void {
    item.reserved = reservedOf(item).add(delta).amount;
  }

  private async addTo(
    tx: EntityManager,
    product: Product,
    unit: TransportUnit,
    quantity: Quantity,
    lot: string | null,
    bestBefore: string | null,
  ): Promise<StockItem> {
    await tx.flush(); // eigene, noch nicht geschriebene Änderungen nicht durch refresh verwerfen
    const existing = await tx.findOne(StockItem, { unit, product, lot, bestBefore }, { refresh: true });
    if (existing) {
      existing.quantity = onHandOf(existing).add(quantity).amount;
      return existing;
    }
    return tx.create(StockItem, {
      id: randomUUID(),
      product,
      unit,
      quantity: quantity.amount,
      reserved: '0',
      unitCode: quantity.unit,
      lot,
      bestBefore,
    });
  }

  private book(
    tx: EntityManager,
    type: BookingType,
    item: StockItem,
    quantity: Quantity,
    reference: string,
    barcode?: string,
  ): StockBooking {
    return tx.create(StockBooking, {
      id: randomUUID(),
      type,
      sku: (item.product as Product).sku,
      barcode: barcode ?? (item.unit as TransportUnit).barcode,
      quantity: quantity.amount,
      unitCode: quantity.unit,
      lot: item.lot ?? null,
      bestBefore: item.bestBefore ?? null,
      reference: reference.slice(0, 120),
    });
  }

  private writeUnits(tx: EntityManager, product: Product, units: { unit: string; factor: string }[]): void {
    const seen = new Set<string>();
    for (const u of units) {
      if (u.unit === product.baseUnit || seen.has(u.unit)) {
        throw new DomainError('invalid', 'UNIT_CONFLICT', `Einheit ${u.unit} ist doppelt oder die Basiseinheit`, { unit: u.unit });
      }
      seen.add(u.unit);
      tx.create(ProductUnit, {
        id: randomUUID(),
        product,
        unitCode: u.unit,
        factor: u.factor,
      });
    }
  }
}

export { isoDate };
