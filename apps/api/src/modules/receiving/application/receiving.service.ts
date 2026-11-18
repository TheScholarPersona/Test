import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import {
  BarcodeSchema,
  GoodsCapturedEvent,
  LocationGroupNameSchema,
  Quantity,
  ReceivingOrderChangedEvent,
  ReceivingOrderCreatedEvent,
  ReceivingOrderStateChangedEvent,
  ReceivingPositionStateChangedEvent,
  TransportUnitTypeCodeSchema,
} from '@wms/shared';
import { ConflictError, DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { InventoryService, type Product } from '../../inventory/index.js';
import { type Location, LocationLookup, type LocationReference } from '../../layout/index.js';
import { MovementService } from '../../movement/index.js';
import { PartnerService } from '../../partner/index.js';
import { type TransportUnit, TransportUnitService } from '../../transport/index.js';
import {
  chooseQuantityPosition,
  deriveOrderState,
  isOpen,
  type PositionState,
  priorityRankOf,
  stateAfterReceipt,
} from '../domain/receiving-rules.js';
import { ReceivingCapture, ReceivingOrder, ReceivingPosition } from '../entities/receiving.entities.js';
import type { BlindCapture, CaptureInput, ChangeReceivingOrder, CreateReceivingOrder, LockReceivingOrder, QuantityCapture, ReceivingQuery, UnitCapture } from '../http/schemas.js';

export interface OrderWithPositions {
  order: ReceivingOrder;
  positions: ReceivingPosition[];
}

export interface CaptureOutcome {
  capture: ReceivingCapture;
  onHand: { amount: string; unit: string } | null;
  order: OrderWithPositions | null;
}

const qty = (amount: string | null | undefined, unit: string | null | undefined) => Quantity.of(normalizeDecimal(amount ?? '0'), unit ?? 'PCS');

@Injectable()
export class ReceivingService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryService,
    private readonly units: TransportUnitService,
    private readonly lookup: LocationLookup,
    private readonly movements: MovementService,
    private readonly partners: PartnerService,
  ) {}

  async list(query: ReceivingQuery): Promise<{ items: OrderWithPositions[]; total: number }> {
    const where: FilterQuery<ReceivingOrder> = {};
    if (query.state) where.state = query.state;
    if (query.supplier) where.supplier = query.supplier;
    if (query.priority) where.priority = query.priority;
    if (query.locked !== undefined) where.locked = query.locked;
    const [orders, total] = await this.em.findAndCount(ReceivingOrder, where, {
      orderBy:
        query.sort === 'priority'
          ? { priorityRank: 'asc', expectedAt: 'asc nulls last', createdAt: 'asc', orderId: 'asc' }
          : { createdAt: 'desc', orderId: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
    const positions = orders.length
      ? await this.em.find(ReceivingPosition, { order: { $in: orders } }, { populate: ['product'], orderBy: { posNo: 'asc' } })
      : [];
    return { items: orders.map((order) => ({ order, positions: positions.filter((p) => p.order === order) })), total };
  }

  async get(orderId: string): Promise<OrderWithPositions> {
    const order = await this.findOrder(this.em, orderId, false);
    return { order, positions: await this.positionsOf(this.em, order) };
  }

  captures(orderId: string): Promise<ReceivingCapture[]> {
    return this.em.find(ReceivingCapture, { order: { orderId } }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  }

  create(input: CreateReceivingOrder): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      if ((await tx.count(ReceivingOrder, { orderId: input.orderId })) > 0) {
        throw new ConflictError('RECEIVING_ORDER_EXISTS', `Wareneingangsauftrag [${input.orderId}] existiert bereits`, { orderId: input.orderId });
      }
      const numbers: number[] = [];
      for (const p of input.positions) {
        numbers.push(p.posNo ?? Math.max(0, ...numbers, ...input.positions.map((x) => x.posNo ?? 0)) + 1);
      }
      if (new Set(numbers).size !== numbers.length) {
        throw new DomainError('invalid', 'DUPLICATE_POSITION', 'Positionsnummern sind mehrfach vergeben', { posNos: numbers });
      }
      const partner = input.supplierCode ? await this.partners.requireRole(tx, input.supplierCode, 'SUPPLIER') : null;
      const order = tx.create(ReceivingOrder, {
        id: randomUUID(),
        orderId: input.orderId,
        supplier: input.supplier ?? partner?.name ?? null,
        supplierCode: partner?.code ?? null,
        priority: input.priority,
        priorityRank: priorityRankOf(input.priority),
        details: input.details && Object.keys(input.details).length ? input.details : null,
        locked: false,
        lockReason: null,
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        state: 'OPEN',
      });
      const positions: ReceivingPosition[] = [];
      for (const [index, p] of input.positions.entries()) {
        const base = { id: randomUUID(), order, posNo: numbers[index]!, state: 'OPEN' as const };
        if (p.kind === 'quantity') {
          const product = await this.inventory.productIn(tx, p.sku);
          this.assertBaseUnit(product, p.quantity.unit);
          positions.push(
            tx.create(ReceivingPosition, {
              ...base,
              kind: 'QUANTITY',
              product,
              expectedQuantity: p.quantity.amount,
              receivedQuantity: '0',
              unitCode: p.quantity.unit,
              expectedBarcode: null,
              unitTypeCode: null,
              receivedBarcode: null,
              closeReason: null,
            }),
          );
        } else {
          positions.push(
            tx.create(ReceivingPosition, {
              ...base,
              kind: 'UNIT',
              product: null,
              expectedQuantity: null,
              receivedQuantity: '0',
              unitCode: null,
              expectedBarcode: p.barcode ?? null,
              unitTypeCode: p.typeCode,
              receivedBarcode: null,
              closeReason: null,
            }),
          );
        }
      }
      this.outbox.record(tx, ReceivingOrderCreatedEvent, { orderId: order.orderId, supplier: order.supplier ?? null, positions: positions.length });
      return { order, positions: positions.sort((a, b) => a.posNo - b.posNo) };
    });
  }

  /** Priorität, Termin oder Detailattribute ändern (Attribute werden zusammengeführt, `null` löscht). */
  change(orderId: string, input: ChangeReceivingOrder): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      this.assertChangeable(order);
      const fields: string[] = [];
      if (input.priority && input.priority !== order.priority) {
        order.priority = input.priority;
        order.priorityRank = priorityRankOf(input.priority);
        fields.push('priority');
      }
      if (input.expectedAt !== undefined) {
        const next = input.expectedAt ? new Date(input.expectedAt) : null;
        if ((next?.getTime() ?? null) !== (order.expectedAt?.getTime() ?? null)) {
          order.expectedAt = next;
          fields.push('expectedAt');
        }
      }
      if (input.details) {
        const details = { ...(order.details ?? {}) };
        for (const [key, value] of Object.entries(input.details)) {
          if (value === null) delete details[key];
          else details[key] = value;
        }
        if (Object.keys(details).length > 30) throw new DomainError('invalid', 'TOO_MANY_DETAILS', 'Höchstens 30 Attribute', { count: Object.keys(details).length });
        if (JSON.stringify(details) !== JSON.stringify(order.details ?? {})) {
          order.details = Object.keys(details).length ? details : null;
          fields.push('details');
        }
      }
      if (fields.length) this.recordChange(tx, order, fields);
      return { order, positions: await this.positionsOf(tx, order) };
    });
  }

  /** Sperren (keine Erfassung mehr) oder entsperren. Wiederholtes Sperren ändert nur den Grund. */
  setLock(orderId: string, locked: boolean, input: LockReceivingOrder = {}): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      this.assertChangeable(order);
      const reason = locked ? (input.reason ?? null) : null;
      if (order.locked !== locked || (order.lockReason ?? null) !== reason) {
        order.locked = locked;
        order.lockReason = reason;
        this.recordChange(tx, order, ['locked']);
      }
      return { order, positions: await this.positionsOf(tx, order) };
    });
  }

  private assertChangeable(order: ReceivingOrder): void {
    if (!['OPEN', 'IN_PROGRESS'].includes(order.state)) {
      throw new RuleViolationError('ORDER_CLOSED', `Wareneingangsauftrag ${order.orderId} ist ${order.state}`, { orderId: order.orderId, state: order.state });
    }
  }

  private recordChange(tx: EntityManager, order: ReceivingOrder, fields: string[]): void {
    this.outbox.record(tx, ReceivingOrderChangedEvent, { orderId: order.orderId, fields, priority: order.priority, locked: order.locked, lockReason: order.lockReason ?? null });
  }

  /** Erfassung gegen den Auftrag – Menge eines Produkts oder eine ganze TU. */
  capture(orderId: string, input: CaptureInput): Promise<CaptureOutcome> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      if (!['OPEN', 'IN_PROGRESS'].includes(order.state)) {
        throw new RuleViolationError('ORDER_CLOSED', `Wareneingangsauftrag ${orderId} ist ${order.state}; Erfassung nicht mehr möglich`, { orderId, state: order.state });
      }
      if (order.locked) {
        throw new RuleViolationError('ORDER_LOCKED', `Wareneingangsauftrag ${orderId} ist gesperrt${order.lockReason ? `: ${order.lockReason}` : ''}`, { orderId, reason: order.lockReason ?? null });
      }
      const positions = await this.positionsOf(tx, order);
      const outcome = input.kind === 'quantity' ? await this.captureQuantity(tx, order, positions, input) : await this.captureUnit(tx, order, positions, input);
      this.recomputeState(tx, order, positions);
      return { ...outcome, order: { order, positions } };
    });
  }

  /** Wareneingang ohne Avis. */
  blindCapture(input: BlindCapture): Promise<CaptureOutcome> {
    return this.em.transactional(async (tx) => {
      const product = await this.inventory.productIn(tx, input.sku);
      const unit = await this.targetUnit(tx, input.unit, input.location);
      const quantity = Quantity.fromDto(input.quantity);
      const { item } = await this.inventory.receiveIn(tx, {
        product,
        unit,
        quantity,
        lot: input.lot ?? null,
        bestBefore: input.bestBefore ?? null,
        reference: 'receiving:blind',
      });
      const capture = await this.recordCapture(tx, {
        kind: 'BLIND',
        order: null,
        posNo: null,
        sku: product.sku,
        quantity,
        unit,
        lot: input.lot ?? null,
        bestBefore: input.bestBefore ?? null,
        overdelivered: false,
        capturedBy: input.capturedBy ?? null,
        putawayGroup: input.putawayGroup,
      });
      return { capture, onHand: { amount: normalizeDecimal(item.quantity), unit: item.unitCode }, order: null };
    });
  }

  /** Unberührte Position stornieren. */
  cancelPosition(orderId: string, posNo: number, reason?: string): Promise<OrderWithPositions> {
    return this.changePosition(orderId, posNo, (p) => {
      if (p.state !== 'OPEN') {
        throw new RuleViolationError('POSITION_NOT_OPEN', `Position ${posNo} ist ${p.state}; nur unberührte Positionen können storniert werden (sonst schließen)`, { posNo, state: p.state });
      }
      return 'CANCELLED';
    }, reason);
  }

  /** Teilweise erfasste Position mit Fehlmenge schließen. */
  closePosition(orderId: string, posNo: number, reason?: string): Promise<OrderWithPositions> {
    return this.changePosition(orderId, posNo, (p) => {
      if (p.state !== 'IN_PROGRESS') {
        throw new RuleViolationError('POSITION_NOT_IN_PROGRESS', `Position ${posNo} ist ${p.state}; schließen ist nur für teilweise erfasste Positionen möglich`, { posNo, state: p.state });
      }
      return 'SHORT';
    }, reason);
  }

  /** Ganzen Auftrag stornieren – nur, solange nichts erfasst wurde. */
  cancelOrder(orderId: string, reason?: string): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      if (order.state !== 'OPEN') {
        throw new RuleViolationError('CANCELLATION_DENIED', `Wareneingangsauftrag ${orderId} ist ${order.state}; stornieren ist nur ohne Erfassungen möglich`, { orderId, state: order.state });
      }
      const positions = await this.positionsOf(tx, order);
      for (const p of positions.filter((x) => x.state === 'OPEN')) this.setPositionState(tx, order, p, 'CANCELLED', reason);
      this.recomputeState(tx, order, positions);
      return { order, positions };
    });
  }

  /** Auftrag abschließen: teilweise erfasste Positionen mit Fehlmenge schließen, unberührte stornieren. */
  completeOrder(orderId: string, reason?: string): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      if (!['OPEN', 'IN_PROGRESS'].includes(order.state)) {
        throw new RuleViolationError('ORDER_CLOSED', `Wareneingangsauftrag ${orderId} ist bereits ${order.state}`, { orderId, state: order.state });
      }
      const positions = await this.positionsOf(tx, order);
      for (const p of positions) {
        if (p.state === 'IN_PROGRESS') this.setPositionState(tx, order, p, 'SHORT', reason ?? 'Auftrag abgeschlossen');
        if (p.state === 'OPEN') this.setPositionState(tx, order, p, 'CANCELLED', reason ?? 'Auftrag abgeschlossen');
      }
      this.recomputeState(tx, order, positions);
      return { order, positions };
    });
  }

  // -------------------------------------------------------------------------

  private async captureQuantity(tx: EntityManager, order: ReceivingOrder, positions: ReceivingPosition[], input: QuantityCapture) {
    const product = await this.inventory.productIn(tx, input.sku);
    const quantity = Quantity.fromDto(input.quantity);
    const views = positions
      .filter((p) => p.kind === 'QUANTITY')
      .map((p) => ({
        posNo: p.posNo,
        sku: (p.product as Product).sku,
        expected: qty(p.expectedQuantity, p.unitCode),
        received: qty(p.receivedQuantity, p.unitCode),
        state: p.state,
      }));
    const choice = chooseQuantityPosition(views, { sku: product.sku, quantity }, product.overdeliveryAllowed);
    const position = positions.find((p) => p.posNo === choice.posNo)!;
    const unit = await this.targetUnit(tx, input.unit, input.location);
    const { item } = await this.inventory.receiveIn(tx, {
      product,
      unit,
      quantity,
      lot: input.lot ?? null,
      bestBefore: input.bestBefore ?? null,
      reference: `receiving:${order.orderId}/${position.posNo}`,
    });
    const received = qty(position.receivedQuantity, position.unitCode).add(quantity);
    position.receivedQuantity = received.amount;
    this.setPositionState(tx, order, position, stateAfterReceipt(qty(position.expectedQuantity, position.unitCode), received));
    const capture = await this.recordCapture(tx, {
      kind: 'QUANTITY',
      order,
      posNo: position.posNo,
      sku: product.sku,
      quantity,
      unit,
      lot: input.lot ?? null,
      bestBefore: input.bestBefore ?? null,
      overdelivered: choice.overdelivered,
      capturedBy: input.capturedBy ?? null,
      putawayGroup: input.putawayGroup,
    });
    return { capture, onHand: { amount: normalizeDecimal(item.quantity), unit: item.unitCode } };
  }

  private async captureUnit(tx: EntityManager, order: ReceivingOrder, positions: ReceivingPosition[], input: UnitCapture) {
    const open = positions.filter((p) => p.kind === 'UNIT' && isOpen(p.state));
    const position =
      open.find((p) => p.expectedBarcode === input.barcode) ??
      open.find((p) => p.expectedBarcode === null && (input.typeCode === undefined || p.unitTypeCode === input.typeCode));
    if (!position) {
      throw new RuleViolationError('NO_OPEN_POSITION', `Keine offene TU-Position für ${input.barcode} in Auftrag ${order.orderId}`, {
        orderId: order.orderId,
        barcode: input.barcode,
      });
    }
    const location = await this.lookup.resolve(tx, input.location);
    const existing = await this.findUnit(tx, input.barcode);
    let unit: TransportUnit;
    if (existing) {
      // Die TU steht physisch am Erfassungsplatz: Ist-Position buchen.
      unit = (await this.units.moveIn(tx, input.barcode, { to: { id: location.id }, mode: 'physical' })).unit;
    } else {
      unit = (
        await this.units.createIn(tx, {
          barcode: input.barcode,
          typeCode: input.typeCode ?? TransportUnitTypeCodeSchema.parse(position.unitTypeCode),
          location: { id: location.id },
          weight: null,
          state: 'AVAILABLE',
          mode: 'physical',
        })
      ).unit;
    }
    position.receivedBarcode = unit.barcode;
    this.setPositionState(tx, order, position, 'COMPLETED');
    const capture = await this.recordCapture(tx, {
      kind: 'UNIT',
      order,
      posNo: position.posNo,
      sku: null,
      quantity: null,
      unit,
      lot: null,
      bestBefore: null,
      overdelivered: false,
      capturedBy: input.capturedBy ?? null,
      putawayGroup: input.putawayGroup,
    });
    return { capture, onHand: null };
  }

  /** Ziel-TU einer Mengenerfassung: bestehende TU oder neu am Erfassungsplatz (die Ware steht physisch dort). */
  private async targetUnit(tx: EntityManager, input: { barcode?: string | undefined; typeCode?: string | undefined }, location: LocationReference): Promise<TransportUnit> {
    if (input.barcode) {
      const existing = await this.findUnit(tx, input.barcode);
      if (existing) return existing;
    }
    if (!input.typeCode) {
      throw new RuleViolationError('TU_TYPE_REQUIRED', 'Für eine neue Transporteinheit muss der TU-Typ angegeben werden', { barcode: input.barcode ?? null });
    }
    const target = await this.lookup.resolve(tx, location);
    return (
      await this.units.createIn(tx, {
        ...(input.barcode ? { barcode: BarcodeSchema.parse(input.barcode) } : {}),
        typeCode: TransportUnitTypeCodeSchema.parse(input.typeCode),
        location: { id: target.id },
        weight: null,
        state: 'AVAILABLE',
        mode: 'physical',
      })
    ).unit;
  }

  private async recordCapture(
    tx: EntityManager,
    data: {
      kind: 'QUANTITY' | 'UNIT' | 'BLIND';
      order: ReceivingOrder | null;
      posNo: number | null;
      sku: string | null;
      quantity: Quantity | null;
      unit: TransportUnit;
      lot: string | null;
      bestBefore: string | null;
      overdelivered: boolean;
      capturedBy: string | null;
      putawayGroup: string | undefined;
    },
  ): Promise<ReceivingCapture> {
    let movementNumber: string | null = null;
    if (data.putawayGroup) {
      const open = await this.movements.openFor(tx, data.unit.barcode);
      movementNumber = open
        ? open.number
        : (
            await this.movements.createIn(tx, {
              barcode: BarcodeSchema.parse(data.unit.barcode),
              type: 'INBOUND',
              target: { group: LocationGroupNameSchema.parse(data.putawayGroup) },
              priority: 'NORMAL',
              initiator: 'receiving',
            })
          ).number;
    }
    const capture = tx.create(ReceivingCapture, {
      id: randomUUID(),
      kind: data.kind,
      order: data.order,
      posNo: data.posNo,
      sku: data.sku,
      quantity: data.quantity?.amount ?? null,
      unitCode: data.quantity?.unit ?? null,
      barcode: data.unit.barcode,
      locationId: (data.unit.location as Location).locationId,
      lot: data.lot,
      bestBefore: data.bestBefore,
      overdelivered: data.overdelivered,
      capturedBy: data.capturedBy,
      movementNumber,
    });
    this.outbox.record(tx, GoodsCapturedEvent, {
      captureId: capture.id,
      orderId: data.order?.orderId ?? null,
      posNo: data.posNo,
      kind: data.kind === 'BLIND' ? 'blind' : data.kind === 'UNIT' ? 'unit' : 'quantity',
      sku: data.sku,
      quantity: data.quantity?.toDto() ?? null,
      barcode: data.unit.barcode,
      overdelivered: data.overdelivered,
      movementNumber,
    });
    return capture;
  }

  private changePosition(orderId: string, posNo: number, next: (p: ReceivingPosition) => PositionState, reason?: string): Promise<OrderWithPositions> {
    return this.em.transactional(async (tx) => {
      const order = await this.findOrder(tx, orderId, true);
      const positions = await this.positionsOf(tx, order);
      const position = positions.find((p) => p.posNo === posNo);
      if (!position) {
        throw new NotFoundError('POSITION_NOT_FOUND', `Position ${posNo} existiert in Auftrag ${orderId} nicht`, { orderId, posNo });
      }
      this.setPositionState(tx, order, position, next(position), reason);
      this.recomputeState(tx, order, positions);
      return { order, positions };
    });
  }

  private setPositionState(tx: EntityManager, order: ReceivingOrder, position: ReceivingPosition, state: PositionState, reason?: string): void {
    if (position.state === state) return;
    const before = position.state;
    position.state = state;
    if (reason !== undefined) position.closeReason = reason;
    this.outbox.record(tx, ReceivingPositionStateChangedEvent, {
      orderId: order.orderId,
      posNo: position.posNo,
      before,
      state,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  private recomputeState(tx: EntityManager, order: ReceivingOrder, positions: ReceivingPosition[]): void {
    const state = deriveOrderState(positions.map((p) => p.state));
    if (state !== order.state) {
      this.outbox.record(tx, ReceivingOrderStateChangedEvent, { orderId: order.orderId, before: order.state, state });
      order.state = state;
    }
  }

  /** @param lock Auftragszeile sperren: Erfassungen auf einen Auftrag laufen nacheinander. */
  private async findOrder(em: EntityManager, orderId: string, lock: boolean): Promise<ReceivingOrder> {
    const order = await em.findOne(ReceivingOrder, { orderId }, lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {});
    if (!order) {
      throw new NotFoundError('RECEIVING_ORDER_NOT_FOUND', `Wareneingangsauftrag [${orderId}] existiert nicht`, { orderId });
    }
    return order;
  }

  private positionsOf(em: EntityManager, order: ReceivingOrder): Promise<ReceivingPosition[]> {
    return em.find(ReceivingPosition, { order }, { populate: ['product'], orderBy: { posNo: 'asc' }, refresh: true });
  }

  private async findUnit(tx: EntityManager, barcode: string): Promise<TransportUnit | null> {
    try {
      return await this.units.loadIn(tx, barcode);
    } catch (error) {
      if (error instanceof NotFoundError && error.code === 'TU_NOT_FOUND') return null;
      throw error;
    }
  }

  private assertBaseUnit(product: Product, unit: string): void {
    if (unit !== product.baseUnit) {
      throw new RuleViolationError('UNIT_MISMATCH', `Produkt ${product.sku} wird in ${product.baseUnit} geführt, avisiert wurde ${unit}`, {
        sku: product.sku,
        baseUnit: product.baseUnit,
        unit,
      });
    }
  }
}
