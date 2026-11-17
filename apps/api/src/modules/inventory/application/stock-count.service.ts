import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Quantity, StockCountChangedEvent } from '@wms/shared';
import { DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type TransportUnit, TransportUnitService } from '../../transport/index.js';
import { type Product, StockCount, StockCountLine, StockItem } from '../entities/inventory.entities.js';
import type { CountQuery, OpenCount, RecordCount } from '../http/schemas.js';
import { InventoryService, isoDate } from './inventory.service.js';

export interface CountWithLines {
  count: StockCount;
  lines: StockCountLine[];
}

const lineKey = (sku: string, lot: string | null | undefined, bestBefore: string | Date | null | undefined) => `${sku}|${lot ?? ''}|${isoDate(bestBefore) ?? ''}`;
export const differenceOf = (line: StockCountLine): Quantity | null =>
  line.counted == null ? null : Quantity.of(normalizeDecimal(line.counted), line.unitCode).subtract(Quantity.of(normalizeDecimal(line.expected), line.unitCode));

/**
 * Inventur je TU: Beim Öffnen wird der Soll-Bestand festgehalten und die TU
 * für andere Buchungen gesperrt. Nach dem Zählen bucht der Abschluss die
 * Differenzen als Korrektur mit Bezug `count:<Nummer>`.
 *
 *   OPEN ──record──▶ COUNTED ──close──▶ CLOSED
 *     │                │ ▲ record (nachzählen)
 *     └──── cancel ────┴──▶ CANCELLED
 */
@Injectable()
export class StockCountService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly units: TransportUnitService,
    private readonly inventory: InventoryService,
  ) {}

  async list(query: CountQuery): Promise<[StockCount[], number]> {
    const where: FilterQuery<StockCount> = {};
    if (query.barcode) where.barcode = query.barcode;
    if (query.state) where.state = query.state;
    return this.em.findAndCount(StockCount, where, { orderBy: { createdAt: 'desc', number: 'desc' }, limit: query.limit, offset: query.offset });
  }

  get(number: string): Promise<CountWithLines> {
    return this.load(this.em, number);
  }

  open(input: OpenCount): Promise<CountWithLines> {
    return this.em.transactional(async (tx) => {
      const unit = await this.units.loadIn(tx, input.barcode);
      await this.inventory.lockUnits(tx, [unit.id]);
      const [row] = await tx.execute<{ n: string }[]>(`select nextval('stock_count_number_seq') as n`);
      const count = tx.create(StockCount, {
        id: randomUUID(),
        number: `IN${String(row!.n).padStart(8, '0')}`,
        barcode: unit.barcode,
        unit,
        state: 'OPEN',
        reference: input.reference ?? null,
        countedBy: null,
        countedAt: null,
        closedAt: null,
      });
      const items = await tx.find(StockItem, { unit: unit.id }, { populate: ['product'], orderBy: { createdAt: 'asc', id: 'asc' } });
      const lines = items.map((item) =>
        tx.create(StockCountLine, {
          id: randomUUID(),
          count,
          sku: (item.product as Product).sku,
          lot: item.lot ?? null,
          bestBefore: item.bestBefore ?? null,
          unitCode: item.unitCode,
          expected: item.quantity,
          counted: null,
        }),
      );
      this.changed(tx, count, lines);
      return { count, lines };
    });
  }

  /**
   * Zählergebnis erfassen (auch erneut). Nicht genannte Soll-Zeilen gelten als
   * nicht gefunden (0); unbekannte Kombinationen werden als gefundener Bestand ergänzt.
   */
  record(number: string, input: RecordCount): Promise<CountWithLines> {
    return this.em.transactional(async (tx) => {
      const { count, lines } = await this.load(tx, number);
      if (count.state !== 'OPEN' && count.state !== 'COUNTED') {
        throw new RuleViolationError('COUNT_CLOSED', `Inventur ${number} ist ${count.state}`, { number, state: count.state });
      }
      const byKey = new Map(lines.map((l) => [lineKey(l.sku, l.lot, l.bestBefore), l]));
      const given = new Set<string>();
      for (const entry of input.lines) {
        const key = lineKey(entry.sku, entry.lot, entry.bestBefore);
        if (given.has(key)) {
          throw new DomainError('invalid', 'DUPLICATE_LINE', `Zeile ${entry.sku} / ${entry.lot ?? '-'} / ${entry.bestBefore ?? '-'} ist doppelt`, { sku: entry.sku });
        }
        given.add(key);
        const product = await this.inventory.productIn(tx, entry.sku);
        const quantity = entry.quantity.amount.match(/^0+(\.0+)?$/)
          ? Quantity.zero(product.baseUnit)
          : await this.inventory.toBase(tx, product, entry.quantity);
        const line = byKey.get(key);
        if (line) {
          line.counted = quantity.amount;
        } else {
          const created = tx.create(StockCountLine, {
            id: randomUUID(),
            count,
            sku: product.sku,
            lot: entry.lot ?? null,
            bestBefore: entry.bestBefore ?? null,
            unitCode: product.baseUnit,
            expected: '0',
            counted: quantity.amount,
          });
          lines.push(created);
          byKey.set(key, created);
        }
      }
      for (const line of lines) {
        if (!given.has(lineKey(line.sku, line.lot, line.bestBefore))) line.counted = '0';
      }
      count.state = 'COUNTED';
      count.countedBy = input.countedBy ?? null;
      count.countedAt = new Date();
      this.changed(tx, count, lines);
      return { count, lines };
    });
  }

  /** Differenzen buchen und die Inventursperre aufheben. */
  close(number: string): Promise<CountWithLines> {
    return this.em.transactional(async (tx) => {
      const { count, lines } = await this.load(tx, number);
      if (count.state !== 'COUNTED') {
        throw new RuleViolationError('COUNT_NOT_COUNTED', `Inventur ${number} ist ${count.state}; abschließen erst nach dem Zählen`, { number, state: count.state });
      }
      const unit = count.unit as TransportUnit | null;
      if (!unit) throw new RuleViolationError('TU_MISSING', `Die TU ${count.barcode} existiert nicht mehr`, { number });
      await this.inventory.lockUnits(tx, [unit.id], count.id);
      const reference = `count:${number}`;
      const reason = `Inventur ${number}`;
      for (const line of lines) {
        const diff = differenceOf(line);
        if (!diff || diff.isZero()) continue;
        const product = await this.inventory.productIn(tx, line.sku);
        const bestBefore = isoDate(line.bestBefore);
        await tx.flush(); // eigene, noch nicht geschriebene Änderungen nicht durch refresh verwerfen
        const item = await tx.findOne(StockItem, { unit: unit.id, product: product.id, lot: line.lot ?? null, bestBefore }, { populate: ['product', 'unit'], refresh: true });
        if (item) {
          await this.inventory.correctIn(tx, item, diff, reference, reason);
        } else if (!diff.isNegative()) {
          await this.inventory.foundIn(tx, product, unit, diff, line.lot ?? null, bestBefore, reference, reason);
        } else {
          throw new RuleViolationError('COUNT_OUTDATED', `Bestand ${line.sku} auf ${count.barcode} fehlt seit dem Öffnen der Inventur`, { number, sku: line.sku });
        }
      }
      count.state = 'CLOSED';
      count.closedAt = new Date();
      this.changed(tx, count, lines);
      return { count, lines };
    });
  }

  cancel(number: string): Promise<CountWithLines> {
    return this.em.transactional(async (tx) => {
      const { count, lines } = await this.load(tx, number);
      if (count.state !== 'OPEN' && count.state !== 'COUNTED') {
        throw new RuleViolationError('COUNT_CLOSED', `Inventur ${number} ist ${count.state}`, { number, state: count.state });
      }
      count.state = 'CANCELLED';
      count.closedAt = new Date();
      this.changed(tx, count, lines);
      return { count, lines };
    });
  }

  private async load(em: EntityManager, number: string): Promise<CountWithLines> {
    const count = await em.findOne(StockCount, { number }, { populate: ['unit'] });
    if (!count) throw new NotFoundError('COUNT_NOT_FOUND', `Inventur [${number}] existiert nicht`, { number });
    const lines = await em.find(StockCountLine, { count: count.id }, { orderBy: { sku: 'asc', lot: 'asc', id: 'asc' } });
    return { count, lines };
  }

  private changed(tx: EntityManager, count: StockCount, lines: StockCountLine[]): void {
    const differences = lines.filter((l) => {
      const d = differenceOf(l);
      return d !== null && !d.isZero();
    }).length;
    this.outbox.record(tx, StockCountChangedEvent, { number: count.number, barcode: count.barcode, state: count.state, differences });
  }
}
