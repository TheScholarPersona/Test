import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery, LockMode } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ProductCreatedEvent, ProductUpdatedEvent, Quantity, StockCorrectedEvent, StockReceivedEvent } from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type TransportUnit, TransportUnitRemovalPolicy } from '../../transport/index.js';
import { Product, StockBooking, StockItem } from '../entities/inventory.entities.js';
import type { CreateProduct, JournalQuery, StockCorrection, StockQuery, UpdateProduct } from '../http/schemas.js';

export interface ReceiveInput {
  product: Product;
  unit: TransportUnit;
  quantity: Quantity;
  lot: string | null;
  /** Mindesthaltbarkeit als ISO-Datum (JJJJ-MM-TT). */
  bestBefore: string | null;
  reference: string;
}

const productSnapshot = (p: Product) => ({ sku: p.sku, description: p.description, baseUnit: p.baseUnit, overdeliveryAllowed: p.overdeliveryAllowed });
const isoDate = (d: Date | string | null | undefined): string | null => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Bestandsführung (erster Ausbau): Produkte, Bestand je Transporteinheit,
 * Buchungsjournal. Umrechnung zwischen Einheiten folgt in Schritt 6.
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly unitRemoval: TransportUnitRemovalPolicy,
  ) {}

  /** TUs mit Bestand dürfen nicht gelöscht werden. */
  onModuleInit(): void {
    this.unitRemoval.register('stock', async (unit) => {
      const items = await this.em.fork().count(StockItem, { unit: unit.id });
      return items > 0 ? `${items} Bestandsposten auf der TU` : null;
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

  createProduct(input: CreateProduct): Promise<Product> {
    return this.em.transactional(async (tx) => {
      if ((await tx.count(Product, { sku: input.sku })) > 0) {
        throw new ConflictError('PRODUCT_EXISTS', `Produkt [${input.sku}] existiert bereits`, { sku: input.sku });
      }
      const product = tx.create(Product, { id: randomUUID(), ...input });
      this.outbox.record(tx, ProductCreatedEvent, productSnapshot(product));
      return product;
    });
  }

  updateProduct(sku: string, input: UpdateProduct): Promise<Product> {
    return this.em.transactional(async (tx) => {
      const product = await this.productIn(tx, sku);
      if (input.baseUnit !== undefined && input.baseUnit !== product.baseUnit && (await tx.count(StockItem, { product })) > 0) {
        throw new RuleViolationError('PRODUCT_UNIT_IN_USE', `Die Basiseinheit von [${sku}] kann nicht geändert werden, solange Bestand existiert`, { sku });
      }
      if (input.description !== undefined) product.description = input.description;
      if (input.baseUnit !== undefined) product.baseUnit = input.baseUnit;
      if (input.overdeliveryAllowed !== undefined) product.overdeliveryAllowed = input.overdeliveryAllowed;
      this.outbox.record(tx, ProductUpdatedEvent, productSnapshot(product));
      return product;
    });
  }

  // --- Bestand ----------------------------------------------------------------

  listStock(query: StockQuery): Promise<[StockItem[], number]> {
    const where: FilterQuery<StockItem> = {};
    if (query.barcode) where.unit = { barcode: query.barcode };
    if (query.sku) where.product = { sku: query.sku };
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
    return this.em.findAndCount(StockBooking, where, { orderBy: { createdAt: 'desc', id: 'asc' }, limit: query.limit, offset: query.offset });
  }

  /**
   * Bestandskorrektur eines Postens (Inventurdifferenz, Bruch, …) mit Grund.
   * Negativer Bestand ist nicht zulässig; fällt der Posten auf 0, wird er entfernt.
   */
  correct(id: string, input: StockCorrection): Promise<{ booking: StockBooking; onHand: Quantity; removed: boolean }> {
    return this.em.transactional(async (tx) => {
      const item = await tx.findOne(StockItem, { id }, { populate: ['product', 'unit'], lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!item) {
        throw new NotFoundError('STOCK_ITEM_NOT_FOUND', `Bestandsposten [${id}] existiert nicht`, { id });
      }
      if (input.delta.unit !== item.unitCode) {
        throw new RuleViolationError('UNIT_MISMATCH', `Der Posten wird in ${item.unitCode} geführt, korrigiert wurde ${input.delta.unit}`, {
          unit: input.delta.unit,
          itemUnit: item.unitCode,
        });
      }
      const delta = Quantity.fromDto(input.delta);
      const onHand = Quantity.of(normalizeDecimal(item.quantity), item.unitCode).add(delta);
      if (onHand.isNegative()) {
        throw new RuleViolationError('STOCK_INSUFFICIENT', `Bestand ${normalizeDecimal(item.quantity)} ${item.unitCode} reicht für die Korrektur ${delta.toString()} nicht`, {
          onHand: normalizeDecimal(item.quantity),
          delta: delta.amount,
        });
      }
      const product = item.product as Product;
      const unit = item.unit as TransportUnit;
      const removed = onHand.isZero();
      if (removed) tx.remove(item);
      else item.quantity = onHand.amount;
      const booking = tx.create(StockBooking, {
        id: randomUUID(),
        type: 'CORRECTION',
        sku: product.sku,
        barcode: unit.barcode,
        quantity: delta.amount,
        unitCode: delta.unit,
        lot: item.lot ?? null,
        bestBefore: item.bestBefore ?? null,
        reference: `correction:${input.reason}`.slice(0, 120),
      });
      this.outbox.record(tx, StockCorrectedEvent, {
        bookingId: booking.id,
        sku: product.sku,
        barcode: unit.barcode,
        delta: delta.toDto(),
        onHand: onHand.toDto(),
        reason: input.reason,
      });
      return { booking, onHand, removed };
    });
  }

  /**
   * Bucht einen Zugang auf eine TU – innerhalb der Transaktion des Aufrufers.
   * Gleichartiger Bestand (Produkt, Charge, MHD) auf derselben TU wird
   * zusammengeführt; die TU-Zeile wird dafür gesperrt, damit parallele
   * Zugänge keinen doppelten Posten anlegen.
   */
  async receiveIn(tx: EntityManager, input: ReceiveInput): Promise<{ item: StockItem; booking: StockBooking }> {
    const { product, unit, quantity } = input;
    if (quantity.unit !== product.baseUnit) {
      throw new RuleViolationError(
        'UNIT_MISMATCH',
        `Produkt ${product.sku} wird in ${product.baseUnit} geführt, erfasst wurde ${quantity.unit}`,
        { sku: product.sku, baseUnit: product.baseUnit, unit: quantity.unit },
      );
    }
    if (quantity.isZero() || quantity.isNegative()) {
      throw new RuleViolationError('INVALID_QUANTITY', 'Die Menge muss größer als 0 sein', { quantity: quantity.amount });
    }
    await tx.execute('select "id" from "transport_unit" where "id" = ? for update', [unit.id]);
    const bestBefore = input.bestBefore;
    let item = await tx.findOne(
      StockItem,
      { unit, product, lot: input.lot, bestBefore },
      { refresh: true },
    );
    if (item) {
      item.quantity = Quantity.of(normalizeDecimal(item.quantity), item.unitCode).add(quantity).amount;
    } else {
      item = tx.create(StockItem, {
        id: randomUUID(),
        product,
        unit,
        quantity: quantity.amount,
        unitCode: quantity.unit,
        lot: input.lot,
        bestBefore,
      });
    }
    const booking = tx.create(StockBooking, {
      id: randomUUID(),
      type: 'RECEIPT',
      sku: product.sku,
      barcode: unit.barcode,
      quantity: quantity.amount,
      unitCode: quantity.unit,
      lot: input.lot,
      bestBefore,
      reference: input.reference,
    });
    this.outbox.record(tx, StockReceivedEvent, {
      bookingId: booking.id,
      sku: product.sku,
      barcode: unit.barcode,
      quantity: quantity.toDto(),
      onHand: { amount: normalizeDecimal(item.quantity), unit: quantity.unit },
      lot: input.lot,
      bestBefore: isoDate(bestBefore),
      reference: input.reference,
    });
    return { item, booking };
  }
}

export { isoDate };
