import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import {
  BarcodeSchema,
  OutboundOrderAllocatedEvent,
  OutboundOrderCreatedEvent,
  OutboundOrderStateChangedEvent,
  OutboundPickConfirmedEvent,
  Quantity,
  type QuantityDto,
} from '@wms/shared';
import { ConflictError, DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { InventoryService, type Product } from '../../inventory/index.js';
import { type Location, LocationLookup } from '../../layout/index.js';
import { MovementService } from '../../movement/index.js';
import { PartnerService } from '../../partner/index.js';
import { AllocationService } from '../../strategy/index.js';
import { TransportOrderService } from '../../transport-order/index.js';
import { TransportUnitClaims, TransportUnitService } from '../../transport/index.js';
import { deriveLineState, deriveOrderState, isClosed, type LineAmounts, openDemand } from '../domain/outbound-rules.js';
import { OutboundLine, OutboundOrder, OutboundPick } from '../entities/outbound.entities.js';
import type { AllocateInput, ConfirmPickInput, CreateOutboundOrder, OutboundQuery, PickQuery, ReasonInput } from '../http/schemas.js';

export interface OrderWithDetails {
  order: OutboundOrder;
  lines: OutboundLine[];
  picks: OutboundPick[];
}

const amountsOf = (line: OutboundLine): LineAmounts => ({
  state: line.state,
  quantity: Quantity.of(normalizeDecimal(line.quantity), line.unitCode),
  allocated: Quantity.of(normalizeDecimal(line.allocated), line.unitCode),
  picked: Quantity.of(normalizeDecimal(line.picked), line.unitCode),
});
const reference = (order: OutboundOrder, line: OutboundLine) => `outbound:${order.orderId}/${line.lineNo}`;

/**
 * Auslagerung: Aufträge mit Bedarf je Produkt. Die Zuteilung wählt den
 * Bestand per Auslagerstrategie und reserviert ihn als Picks; die Quittung
 * eines Picks bucht den Abgang gegen die Reservierung. Optional entstehen
 * Lagerbewegungen oder Transportaufträge zum Ziel des Auftrags.
 */
@Injectable()
export class OutboundService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly inventory: InventoryService,
    private readonly allocation: AllocationService,
    private readonly units: TransportUnitService,
    private readonly claims: TransportUnitClaims,
    private readonly movements: MovementService,
    private readonly transportOrders: TransportOrderService,
    private readonly partners: PartnerService,
  ) {}

  async list(query: OutboundQuery): Promise<{ items: OrderWithDetails[]; total: number }> {
    const where: FilterQuery<OutboundOrder> = query.state ? { state: query.state } : {};
    const [orders, total] = await this.em.findAndCount(OutboundOrder, where, { orderBy: { createdAt: 'desc', orderId: 'asc' }, limit: query.limit, offset: query.offset });
    return { items: await Promise.all(orders.map((o) => this.details(this.em, o))), total };
  }

  get(orderId: string): Promise<OrderWithDetails> {
    return this.load(this.em, orderId);
  }

  /** Arbeitsliste der Picks, sortiert nach Platz (Wegoptimierung folgt später). */
  /** Auftrag innerhalb der Transaktion des Aufrufers (z. B. für eine Sendung), mit Ziel. */
  async orderIn(em: EntityManager, orderId: string): Promise<OutboundOrder> {
    const order = await em.findOne(OutboundOrder, { orderId }, { populate: ['target'] });
    if (!order) throw new NotFoundError('OUTBOUND_ORDER_NOT_FOUND', `Auslagerauftrag [${orderId}] existiert nicht`, { orderId });
    return order;
  }

  listPicks(query: PickQuery): Promise<[OutboundPick[], number]> {
    const where: FilterQuery<OutboundPick> = { state: query.state };
    if (query.barcode) where.barcode = query.barcode;
    if (query.orderId) where.line = { order: { orderId: query.orderId } };
    return this.em.findAndCount(OutboundPick, where, {
      populate: ['line', 'line.order', 'line.product'],
      orderBy: { locationCoordinate: 'asc', createdAt: 'asc', id: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
  }

  create(input: CreateOutboundOrder): Promise<OrderWithDetails> {
    return this.em.transactional(async (tx) => {
      if (await tx.count(OutboundOrder, { orderId: input.orderId })) {
        throw new ConflictError('OUTBOUND_ORDER_EXISTS', `Auslagerauftrag [${input.orderId}] existiert bereits`, { orderId: input.orderId });
      }
      const target = input.target ? await this.lookup.resolve(tx, input.target) : null;
      const partner = input.customerCode ? await this.partners.requireRole(tx, input.customerCode, 'CUSTOMER') : null;
      const pick = <K extends 'name' | 'street' | 'postalCode' | 'city' | 'country'>(key: K): string | null => {
        const given = input.shipTo?.[key];
        if (given !== undefined) return given;
        return partner?.[key] ?? null;
      };
      const shipTo = { name: pick('name'), street: pick('street'), postalCode: pick('postalCode'), city: pick('city'), country: pick('country') };
      const order = tx.create(OutboundOrder, {
        id: randomUUID(),
        orderId: input.orderId,
        customer: input.customer ?? partner?.code ?? null,
        customerCode: partner?.code ?? null,
        shipToName: shipTo.name,
        shipToStreet: shipTo.street,
        shipToPostalCode: shipTo.postalCode,
        shipToCity: shipTo.city,
        shipToCountry: shipTo.country,
        priority: input.priority,
        target,
        targetCoordinate: target?.locationId ?? null,
        state: 'CREATED',
        closeReason: null,
      });
      let lineNo = 0;
      for (const l of input.lines) {
        lineNo += 1;
        const product = await this.inventory.productIn(tx, l.sku);
        const quantity = await this.inventory.toBase(tx, product, l.quantity);
        tx.create(OutboundLine, {
          id: randomUUID(),
          order,
          lineNo,
          product,
          quantity: quantity.amount,
          unitCode: quantity.unit,
          lot: l.lot ?? null,
          allocated: '0',
          picked: '0',
          state: 'OPEN',
        });
      }
      this.outbox.record(tx, OutboundOrderCreatedEvent, { orderId: order.orderId, customer: order.customer ?? null, lines: input.lines.length });
      await tx.flush();
      return this.details(tx, order);
    });
  }

  /**
   * Teilt den offenen Bedarf aller Positionen zu: Auslagerstrategie wählt die
   * Posten, jede Entnahme wird reserviert. Bei zu wenig Bestand bleibt der Rest
   * offen (erneut zuteilbar). Mehrfach aufrufbar.
   */
  allocate(orderId: string, input: AllocateInput): Promise<OrderWithDetails> {
    return this.em.transactional(async (tx) => {
      const { order, lines } = await this.loadLocked(tx, orderId);
      this.assertOpen(order);
      if (input.transport !== 'none' && !order.target) {
        throw new DomainError('invalid', 'TARGET_REQUIRED', `Für ${input.transport} braucht der Auftrag ein Ziel (target)`, { orderId });
      }
      const before = order.state;
      const created: { pick: OutboundPick; line: OutboundLine }[] = [];
      const shortfalls: { lineNo: number; sku: string; missing: QuantityDto }[] = [];
      for (const line of lines) {
        const demand = openDemand(amountsOf(line));
        if (demand.isZero()) continue;
        const product = line.product as Product;
        const result = await this.allocation.decideIn(tx, {
          sku: product.sku,
          quantity: demand.toDto(),
          lot: line.lot,
          subject: `${order.orderId}/${line.lineNo}`,
          orderPriority: order.priority,
          customer: order.customer,
        });
        let allocated = Quantity.zero(line.unitCode);
        for (const planned of result.plan) {
          const quantity = Quantity.of(planned.quantity, line.unitCode);
          const reservation = await this.inventory.reserveIn(tx, planned.key, { quantity: quantity.toDto(), reference: reference(order, line) });
          const pick = tx.create(OutboundPick, {
            id: randomUUID(),
            line,
            stockItemId: planned.key,
            reservationId: reservation.id,
            barcode: planned.barcode,
            locationCoordinate: planned.locationId,
            quantity: quantity.amount,
            picked: '0',
            state: 'OPEN',
            decisionId: result.decision.id,
            movementNumber: null,
            transportOrderNumber: null,
            transportNote: null,
            pickedBy: null,
            pickedAt: null,
          });
          created.push({ pick, line });
          allocated = allocated.add(quantity);
        }
        line.allocated = amountsOf(line).allocated.add(allocated).amount;
        line.state = deriveLineState(amountsOf(line));
        const missing = demand.subtract(allocated);
        if (!missing.isZero()) shortfalls.push({ lineNo: line.lineNo, sku: product.sku, missing: missing.toDto() });
      }
      if (input.transport !== 'none') await this.createTransports(tx, order, input.transport, created.map((c) => c.pick));
      this.updateState(tx, order, lines, before);
      this.outbox.record(tx, OutboundOrderAllocatedEvent, {
        orderId: order.orderId,
        state: order.state,
        picks: created.map(({ pick, line }) => ({
          pickId: pick.id,
          lineNo: line.lineNo,
          sku: (line.product as Product).sku,
          barcode: pick.barcode,
          locationId: pick.locationCoordinate,
          quantity: Quantity.of(normalizeDecimal(pick.quantity), line.unitCode).toDto(),
        })),
        shortfalls,
      });
      await tx.flush();
      return this.details(tx, order);
    });
  }

  /**
   * Quittiert eine Entnahme: bucht den Abgang gegen die Reservierung. Weniger
   * als zugeteilt ist eine Fehlmenge; der Rest der Reservierung wird
   * freigegeben und der Bedarf ist wieder zuteilbar.
   */
  confirmPick(orderId: string, pickId: string, input: ConfirmPickInput): Promise<OrderWithDetails> {
    return this.em.transactional(async (tx) => {
      const { order, lines } = await this.loadLocked(tx, orderId);
      this.assertOpen(order);
      const pick = await tx.findOne(OutboundPick, { id: pickId, line: { order: order.id } }, { populate: ['line', 'line.product'] });
      if (!pick) throw new NotFoundError('PICK_NOT_FOUND', `Pick [${pickId}] gehört nicht zu Auftrag ${orderId}`, { orderId, pickId });
      if (pick.state !== 'OPEN') throw new RuleViolationError('PICK_NOT_OPEN', `Pick ist ${pick.state}`, { pickId, state: pick.state });
      const line = lines.find((l) => l.id === (pick.line as OutboundLine).id)!;
      const product = line.product as Product;
      const planned = Quantity.of(normalizeDecimal(pick.quantity), line.unitCode);
      const taken = input.quantity === undefined ? planned : input.quantity.amount.match(/^0+(\.0+)?$/) ? Quantity.zero(line.unitCode) : await this.inventory.toBase(tx, product, input.quantity);
      if (taken.compareTo(planned) > 0) {
        throw new RuleViolationError('EXCEEDS_PICK', `Entnommen ${taken.toString()}, zugeteilt nur ${planned.toString()}`, { quantity: taken.amount, planned: planned.amount });
      }
      const short = taken.compareTo(planned) < 0;
      if (input.packInto) {
        await this.pack(tx, order, pick, input.packInto, taken, short, reference(order, line));
      } else if (!taken.isZero()) {
        await this.inventory.issueIn(tx, pick.stockItemId, { quantity: taken.toDto(), reference: reference(order, line), reservationId: pick.reservationId ?? undefined });
      }
      if (short && pick.reservationId) await this.inventory.releaseReservationIn(tx, pick.reservationId, { ignoreMissing: true });
      pick.picked = taken.amount;
      pick.state = short ? 'SHORT' : 'PICKED';
      pick.pickedBy = input.pickedBy ?? null;
      pick.pickedAt = new Date();
      const amounts = amountsOf(line);
      line.picked = amounts.picked.add(taken).amount;
      line.allocated = amounts.allocated.subtract(planned.subtract(taken)).amount;
      line.state = deriveLineState(amountsOf(line));
      this.outbox.record(tx, OutboundPickConfirmedEvent, {
        orderId: order.orderId,
        pickId: pick.id,
        lineNo: line.lineNo,
        sku: product.sku,
        barcode: pick.barcode,
        quantity: taken.toDto(),
        short,
        packedInto: pick.packedInto ?? null,
      });
      this.updateState(tx, order, lines, order.state);
      await tx.flush();
      return this.details(tx, order);
    });
  }

  /** Abschluss mit Fehlmengen: offene Positionen werden SHORT. Nur ohne offene Picks. */
  complete(orderId: string, input: ReasonInput): Promise<OrderWithDetails> {
    return this.em.transactional(async (tx) => {
      const { order, lines, picks } = await this.loadLocked(tx, orderId);
      this.assertOpen(order);
      const open = picks.filter((p) => p.state === 'OPEN');
      if (open.length > 0) {
        throw new RuleViolationError('PICKS_OPEN', `${open.length} Pick(s) sind noch offen; erst quittieren oder den Auftrag stornieren`, { open: open.map((p) => p.id) });
      }
      const before = order.state;
      for (const line of lines) if (!isClosed(line.state)) line.state = 'SHORT';
      order.closeReason = input.reason ?? null;
      this.updateState(tx, order, lines, before);
      await tx.flush();
      return this.details(tx, order);
    });
  }

  /** Storno: offene Picks werden freigegeben; bereits Entnommenes bleibt gebucht. */
  cancel(orderId: string, input: ReasonInput): Promise<OrderWithDetails> {
    return this.em.transactional(async (tx) => {
      const { order, lines, picks } = await this.loadLocked(tx, orderId);
      this.assertOpen(order);
      const before = order.state;
      for (const pick of picks.filter((p) => p.state === 'OPEN')) {
        if (pick.reservationId) await this.inventory.releaseReservationIn(tx, pick.reservationId, { ignoreMissing: true });
        pick.state = 'CANCELLED';
        const line = lines.find((l) => l.id === (pick.line as OutboundLine).id)!;
        line.allocated = amountsOf(line).allocated.subtract(Quantity.of(normalizeDecimal(pick.quantity), line.unitCode)).amount;
      }
      for (const line of lines) if (!isClosed(line.state)) line.state = 'CANCELLED';
      order.state = 'CANCELLED';
      order.closeReason = input.reason ?? null;
      this.outbox.record(tx, OutboundOrderStateChangedEvent, { orderId: order.orderId, before, state: 'CANCELLED' });
      await tx.flush();
      return this.details(tx, order);
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Je TU mit neuem Pick eine Bewegung bzw. einen Transportauftrag zum Ziel.
   * Eine bereits belegte TU, eine TU am Ziel oder ein abgelehntes Ziel ist
   * kein Fehler der Zuteilung: der Grund steht im Pick (`transportNote`).
   */
  /**
   * Packen am Packplatz: Die Versand-TU muss am Ziel des Auftrags stehen. Die entnommene Menge wird
   * aus der Reservierung auf die Versand-TU umgebucht; ist die Versand-TU die Pick-TU selbst, wird
   * die ganze TU versendet (dann muss der Pick den gesamten Posten umfassen).
   */
  private async pack(tx: EntityManager, order: OutboundOrder, pick: OutboundPick, barcode: string, taken: Quantity, short: boolean, ref: string): Promise<void> {
    const station = order.target as Location | null;
    if (!station) throw new RuleViolationError('PACK_STATION_MISSING', `Auftrag ${order.orderId} hat kein Ziel (Packplatz)`, { orderId: order.orderId });
    const unit = await this.units.loadIn(tx, barcode);
    const at = unit.location as Location;
    if (at.id !== station.id) {
      throw new RuleViolationError('PACK_UNIT_NOT_AT_STATION', `Versand-TU ${barcode} steht auf ${at.locationId}, Packplatz ist ${station.locationId}`, { barcode, location: at.locationId, station: station.locationId });
    }
    if (barcode === pick.barcode) {
      const item = await this.inventory.stockItemIn(tx, pick.stockItemId);
      if (short || item.quantity.compareTo(taken) !== 0) {
        throw new RuleViolationError('PACK_IN_PLACE_PARTIAL', `TU ${barcode} wird nur ganz versendet: Pick ${taken.toString()}, Bestand ${item.quantity.toString()}`, { barcode });
      }
      if (pick.reservationId) await this.inventory.consumeReservationIn(tx, pick.stockItemId, pick.reservationId, taken);
    } else if (!taken.isZero()) {
      await this.inventory.transferIn(tx, pick.stockItemId, { to: unit, quantity: taken, reference: ref, reservationId: pick.reservationId ?? undefined });
    }
    if (!taken.isZero()) pick.packedInto = barcode;
  }

  private async createTransports(tx: EntityManager, order: OutboundOrder, kind: 'movement' | 'transport-order', picks: OutboundPick[]): Promise<void> {
    const target = order.target as Location;
    const byBarcode = new Map<string, OutboundPick[]>();
    for (const pick of picks) byBarcode.set(pick.barcode, [...(byBarcode.get(pick.barcode) ?? []), pick]);
    for (const [barcode, group] of byBarcode) {
      const note = (text: string) => group.forEach((p) => (p.transportNote = text.slice(0, 200)));
      const unit = await this.units.loadIn(tx, barcode);
      if ((unit.location as Location).id === target.id) {
        note(`TU steht bereits auf ${target.locationId}`);
        continue;
      }
      const claims = await this.claims.claims(tx, unit);
      if (claims.length > 0) {
        note(`Kein Transport: ${claims.map((c) => c.description).join('; ')}`);
        continue;
      }
      try {
        if (kind === 'movement') {
          const movement = await this.movements.createIn(tx, {
            barcode: BarcodeSchema.parse(barcode),
            type: 'OUTBOUND',
            target: { location: { id: target.id } },
            priority: order.priority,
            initiator: `outbound:${order.orderId}`,
          });
          group.forEach((p) => (p.movementNumber = movement.number));
        } else {
          const to = await this.transportOrders.createIn(tx, {
            barcode: BarcodeSchema.parse(barcode),
            target: { location: { id: target.id } },
            priority: order.priority,
            redirect: false,
            autoStart: true,
            initiator: `outbound:${order.orderId}`,
          });
          group.forEach((p) => (p.transportOrderNumber = to.number));
          if (to.problemCode) note(`Transportauftrag wartet: ${to.problemCode}`);
        }
      } catch (error) {
        // Fachliche Ablehnung vor dem Schreiben (z. B. Ziel voll): Zuteilung bleibt gültig.
        if (error instanceof DomainError) note(`Kein Transport: ${error.code} – ${error.message}`);
        else throw error;
      }
    }
  }

  private updateState(tx: EntityManager, order: OutboundOrder, lines: OutboundLine[], before: OutboundOrder['state']): void {
    const state = deriveOrderState(order.state, lines.map(amountsOf));
    order.state = state;
    if (state !== before) this.outbox.record(tx, OutboundOrderStateChangedEvent, { orderId: order.orderId, before, state });
  }

  private assertOpen(order: OutboundOrder): void {
    if (order.state === 'COMPLETED' || order.state === 'CANCELLED') {
      throw new RuleViolationError('ORDER_CLOSED', `Auslagerauftrag ${order.orderId} ist ${order.state}`, { orderId: order.orderId, state: order.state });
    }
  }

  /** Auftragszeile sperren, damit Zuteilung, Quittung und Storno eines Auftrags nacheinander laufen. */
  private async loadLocked(tx: EntityManager, orderId: string): Promise<OrderWithDetails> {
    const order = await tx.findOne(OutboundOrder, { orderId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (!order) throw new NotFoundError('OUTBOUND_ORDER_NOT_FOUND', `Auslagerauftrag [${orderId}] existiert nicht`, { orderId });
    return this.details(tx, order, true);
  }

  private async load(em: EntityManager, orderId: string): Promise<OrderWithDetails> {
    const order = await em.findOne(OutboundOrder, { orderId });
    if (!order) throw new NotFoundError('OUTBOUND_ORDER_NOT_FOUND', `Auslagerauftrag [${orderId}] existiert nicht`, { orderId });
    return this.details(em, order);
  }

  private async details(em: EntityManager, order: OutboundOrder, refresh = false): Promise<OrderWithDetails> {
    await em.populate(order, ['target']);
    const lines = await em.find(OutboundLine, { order: order.id }, { populate: ['product'], orderBy: { lineNo: 'asc' }, refresh });
    const picks = await em.find(OutboundPick, { line: { order: order.id } }, { populate: ['line', 'line.product'], orderBy: { createdAt: 'asc', id: 'asc' }, refresh });
    return { order, lines, picks };
  }
}
