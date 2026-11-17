import { randomUUID } from 'node:crypto';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ShipmentChangedEvent, ShipmentCreatedEvent, ShipmentShippedEvent } from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { requestContext } from '../../../common/request-context.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { InventoryService } from '../../inventory/index.js';
import type { Location } from '../../layout/index.js';
import { OutboundService } from '../../outbound/index.js';
import { PartnerService } from '../../partner/index.js';
import { TransportUnitService } from '../../transport/index.js';
import { Shipment, ShipmentUnit } from '../entities/shipment.entities.js';
import type { CancelShipment, CreateShipment, LoadShipmentUnit, ShipmentQuery, ShipShipment } from '../http/schemas.js';

export interface LoadedShipment {
  shipment: Shipment;
  units: ShipmentUnit[];
}

const ACTIVE = ['OPEN', 'LOADED'] as const;
const actor = (): string | null => requestContext.get()?.actor ?? null;
const operatorOf = (a: string | null): string | null => (a?.startsWith('user:') ? a.slice(5) : a);

function snapshot({ shipment, units }: LoadedShipment) {
  return { number: shipment.number, orderId: shipment.orderId, carrierCode: shipment.carrierCode ?? null, state: shipment.state, units: units.map((u) => ({ barcode: u.barcode, loaded: u.loaded })) };
}

/**
 * Versand: Sendungen aus gepackten TUs am Packplatz, Ladekontrolle per Scan und Warenausgang.
 * Beim Warenausgang wird der Bestand jeder TU ausgebucht (Buchungsart SHIP) und die TU gelöscht;
 * die Sendung behält Barcode und Inhalt als Historie.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly outbound: OutboundService,
    private readonly partners: PartnerService,
    private readonly units: TransportUnitService,
    private readonly inventory: InventoryService,
  ) {}

  create(input: CreateShipment): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const order = await this.outbound.orderIn(tx, input.orderId);
      if (order.state === 'CANCELLED') throw new RuleViolationError('ORDER_CANCELLED', `Auslagerauftrag ${order.orderId} ist storniert`, { orderId: order.orderId });
      const carrier = input.carrierCode ? await this.partners.requireRole(tx, input.carrierCode, 'CARRIER') : null;
      const [row] = await tx.execute<{ n: string }[]>(`select nextval('shipment_number_seq') as n`);
      const shipment = tx.create(Shipment, {
        id: randomUUID(),
        number: `SH${String(row!.n).padStart(8, '0')}`,
        orderId: order.orderId,
        customerCode: order.customerCode ?? null,
        shipToName: order.shipToName ?? null,
        shipToStreet: order.shipToStreet ?? null,
        shipToPostalCode: order.shipToPostalCode ?? null,
        shipToCity: order.shipToCity ?? null,
        shipToCountry: order.shipToCountry ?? null,
        carrierCode: carrier?.code ?? null,
        state: 'OPEN',
        createdBy: actor(),
      });
      const units: ShipmentUnit[] = [];
      for (const barcode of input.units ?? []) units.push(await this.addUnit(tx, shipment, units, barcode));
      this.outbox.record(tx, ShipmentCreatedEvent, snapshot({ shipment, units }));
      return { shipment, units };
    });
  }

  get(number: string): Promise<LoadedShipment> {
    return this.loadShipment(this.em, number);
  }

  async list(query: ShipmentQuery): Promise<{ items: LoadedShipment[]; total: number }> {
    const where = { ...(query.state ? { state: { $in: query.state } } : {}), ...(query.orderId ? { orderId: query.orderId } : {}) };
    const [shipments, total] = await this.em.findAndCount(Shipment, where, { orderBy: { createdAt: 'desc', number: 'desc' }, limit: query.limit, offset: query.offset });
    const units = shipments.length ? await this.em.find(ShipmentUnit, { shipment: { $in: shipments.map((s) => s.id) } }, { orderBy: { createdAt: 'asc', barcode: 'asc' } }) : [];
    return { items: shipments.map((shipment) => ({ shipment, units: units.filter((u) => (u.shipment as Shipment).id === shipment.id) })), total };
  }

  add(number: string, barcode: string): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.loadShipment(tx, number, true);
      this.assertState(loaded.shipment, ['OPEN']);
      const unit = await this.addUnit(tx, loaded.shipment, loaded.units, barcode);
      loaded.units.push(unit);
      this.outbox.record(tx, ShipmentChangedEvent, { ...snapshot(loaded), change: 'unit-added', barcode });
      return loaded;
    });
  }

  remove(number: string, barcode: string): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.loadShipment(tx, number, true);
      this.assertState(loaded.shipment, ['OPEN', 'LOADED']);
      const unit = this.member(loaded, barcode);
      tx.remove(unit);
      loaded.units = loaded.units.filter((u) => u !== unit);
      // Fehlt danach keine TU mehr, bleibt die Sendung verladen; sonst ist sie wieder offen.
      if (loaded.shipment.state === 'LOADED' && loaded.units.length === 0) this.reopen(loaded.shipment);
      this.outbox.record(tx, ShipmentChangedEvent, { ...snapshot(loaded), change: 'unit-removed', barcode });
      return loaded;
    });
  }

  /**
   * Ladekontrolle: Der gescannte Barcode muss zur Sendung gehören (sonst 409 `WRONG_UNIT`, z. B.
   * falsche Palette am Tor). Sind alle TUs gescannt, ist die Sendung `LOADED`.
   */
  loadUnit(number: string, input: LoadShipmentUnit): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.loadShipment(tx, number, true);
      this.assertState(loaded.shipment, ['OPEN']);
      const unit = loaded.units.find((u) => u.barcode === input.barcode);
      if (!unit) throw new RuleViolationError('WRONG_UNIT', `TU ${input.barcode} gehört nicht zur Sendung ${number}`, { number, barcode: input.barcode });
      if (unit.loaded) throw new ConflictError('UNIT_ALREADY_LOADED', `TU ${input.barcode} ist schon verladen`, { number, barcode: input.barcode });
      unit.loaded = true;
      unit.loadedAt = new Date();
      unit.loadedBy = input.loadedBy ?? operatorOf(actor());
      this.outbox.record(tx, ShipmentChangedEvent, { ...snapshot(loaded), change: 'unit-loaded', barcode: input.barcode });
      if (loaded.units.every((u) => u.loaded)) {
        loaded.shipment.state = 'LOADED';
        loaded.shipment.loadedAt = new Date();
        this.outbox.record(tx, ShipmentChangedEvent, { ...snapshot(loaded), change: 'loaded', barcode: null });
      }
      return loaded;
    });
  }

  /** Warenausgang: nur verladene Sendungen. Bucht den Bestand aus und löscht die TUs. */
  ship(number: string, input: ShipShipment): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.loadShipment(tx, number, true);
      this.assertState(loaded.shipment, ['LOADED']);
      const reference = `shipment:${number}`;
      for (const unit of loaded.units) {
        const tu = await this.units.loadIn(tx, unit.barcode);
        unit.contents = await this.inventory.shipUnitIn(tx, tu, reference);
        await this.units.deleteIn(tx, unit.barcode);
      }
      loaded.shipment.state = 'SHIPPED';
      loaded.shipment.shippedAt = new Date();
      loaded.shipment.shippedBy = input.shippedBy ?? operatorOf(actor());
      this.outbox.record(tx, ShipmentShippedEvent, {
        number,
        orderId: loaded.shipment.orderId,
        carrierCode: loaded.shipment.carrierCode ?? null,
        units: loaded.units.map((u) => ({ barcode: u.barcode, contents: u.contents ?? [] })),
      });
      return loaded;
    });
  }

  cancel(number: string, input: CancelShipment): Promise<LoadedShipment> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.loadShipment(tx, number, true);
      this.assertState(loaded.shipment, ['OPEN', 'LOADED']);
      loaded.shipment.state = 'CANCELLED';
      loaded.shipment.cancelReason = input.reason ?? null;
      this.outbox.record(tx, ShipmentChangedEvent, { ...snapshot(loaded), change: 'cancelled', barcode: null });
      return loaded;
    });
  }

  // ---------------------------------------------------------------------------

  /** TU prüfen und aufnehmen: am Packplatz des Auftrags, mit Bestand, in keiner anderen offenen Sendung. */
  private async addUnit(tx: EntityManager, shipment: Shipment, current: ShipmentUnit[], barcode: string): Promise<ShipmentUnit> {
    if (current.some((u) => u.barcode === barcode)) throw new ConflictError('UNIT_IN_SHIPMENT', `TU ${barcode} ist schon in der Sendung`, { barcode });
    const tu = await this.units.loadIn(tx, barcode);
    const taken = await tx.findOne(ShipmentUnit, { barcode, shipment: { state: { $in: [...ACTIVE] } } }, { populate: ['shipment'] });
    if (taken) throw new ConflictError('UNIT_IN_OTHER_SHIPMENT', `TU ${barcode} ist in Sendung ${(taken.shipment as Shipment).number}`, { barcode, shipment: (taken.shipment as Shipment).number });
    const order = await this.outbound.orderIn(tx, shipment.orderId);
    const station = order.target as Location | null;
    const at = tu.location as Location;
    if (station && at.id !== station.id) {
      throw new RuleViolationError('UNIT_NOT_AT_STATION', `TU ${barcode} steht auf ${at.locationId}, Packplatz ist ${station.locationId}`, { barcode, location: at.locationId, station: station.locationId });
    }
    if (!(await this.inventory.hasStockIn(tx, tu.id))) throw new RuleViolationError('UNIT_EMPTY', `TU ${barcode} ist leer`, { barcode });
    return tx.create(ShipmentUnit, { id: randomUUID(), shipment, barcode, loaded: false });
  }

  private member(loaded: LoadedShipment, barcode: string): ShipmentUnit {
    const unit = loaded.units.find((u) => u.barcode === barcode);
    if (!unit) throw new NotFoundError('UNIT_NOT_IN_SHIPMENT', `TU ${barcode} gehört nicht zur Sendung ${loaded.shipment.number}`, { number: loaded.shipment.number, barcode });
    return unit;
  }

  private reopen(shipment: Shipment): void {
    shipment.state = 'OPEN';
    shipment.loadedAt = null;
  }

  private assertState(shipment: Shipment, allowed: readonly Shipment['state'][]): void {
    if (!allowed.includes(shipment.state)) {
      throw new RuleViolationError('SHIPMENT_STATE', `Sendung ${shipment.number} ist ${shipment.state}`, { number: shipment.number, state: shipment.state, allowed });
    }
  }

  private async loadShipment(em: EntityManager, number: string, lock = false): Promise<LoadedShipment> {
    const shipment = await em.findOne(Shipment, { number }, lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {});
    if (!shipment) throw new NotFoundError('SHIPMENT_NOT_FOUND', `Sendung ${number} gibt es nicht`, { number });
    const units = await em.find(ShipmentUnit, { shipment: shipment.id }, { orderBy: { createdAt: 'asc', barcode: 'asc' } });
    return { shipment, units };
  }
}
