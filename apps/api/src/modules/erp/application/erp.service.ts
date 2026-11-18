import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type ErpInboundMessage, ErpMessageFailedEvent, ErpMessageSentEvent, type ErpOutboundMessage, type ErpOutboundType, type EventEnvelope } from '@wms/shared';
import { ZodError } from 'zod';
import { DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { CreateProductSchema, InventoryService } from '../../inventory/index.js';
import { CreateOutboundOrderSchema, OutboundService } from '../../outbound/index.js';
import { CreateReceivingOrderSchema, ReceivingService } from '../../receiving/index.js';
import { ERP_LEASE_MS, erpMessagesFor, erpRetryDelayMs, type Outbound, referenceOf } from '../domain/erp-mapping.js';
import { ErpMessage } from '../entities/erp-message.entity.js';
import type { ErpMessageQuery } from '../http/schemas.js';



/** Ergebnis einer Verarbeitung: fachlicher Fehler mit Code oder Erfolg mit Kurzinfo. */
function describe(error: unknown): string {
  if (error instanceof DomainError) return `${error.code}: ${error.message}`;
  if (error instanceof ZodError) return `INVALID_DATA: ${error.issues.map((i) => `${i.path.join('.') || '(Nachricht)'} ${i.message}`).join('; ')}`;
  return `INTERNAL: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * ERP-Anbindung, formatneutral. Eingang: Artikel, Avise und Auslageraufträge (idempotent je Nachrichten-ID).
 * Ausgang: Rückmeldungen entstehen in derselben Transaktion wie die Buchung (über die Outbox) und werden von
 * Node-RED abgeholt und quittiert. Alles wird protokolliert; Fehlschläge lassen sich erneut anstoßen.
 */
@Injectable()
export class ErpService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly inventory: InventoryService,
    private readonly receiving: ReceivingService,
    private readonly outbound: OutboundService,
  ) {}

  onModuleInit(): void {
    if (!this.config.erp.exportEnabled) return;
    this.outbox.onRecord((em, envelope) => {
      for (const message of erpMessagesFor(envelope)) this.createOutbound(em, message, envelope);
    });
  }

  // --- Eingang ------------------------------------------------------------------------------

  /** Nachricht annehmen und verarbeiten. Dieselbe `messageId` noch einmal liefert das gespeicherte Ergebnis. */
  async receive(input: ErpInboundMessage): Promise<{ message: ErpMessage; duplicate: boolean }> {
    const em = this.em.fork();
    const message = em.create(ErpMessage, {
      id: randomUUID(),
      direction: 'IN',
      messageId: input.messageId,
      type: input.type,
      action: input.action,
      state: 'PENDING',
      reference: 'orderId' in input.data ? input.data.orderId : 'sku' in input.data ? input.data.sku : null,
      payload: input as unknown as Record<string, unknown>,
      occurredAt: new Date(),
    });
    try {
      await em.flush();
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const existing = await this.em.fork().findOneOrFail(ErpMessage, { direction: 'IN', messageId: input.messageId });
      return { message: existing, duplicate: true };
    }
    return { message: await this.process(message.id), duplicate: false };
  }

  private async process(id: string): Promise<ErpMessage> {
    let result: Record<string, unknown> | null = null;
    let failure: string | null = null;
    const stored = await this.em.fork().findOneOrFail(ErpMessage, id);
    try {
      result = await this.apply(stored.payload as unknown as ErpInboundMessage);
    } catch (error) {
      failure = describe(error);
    }
    return this.em.fork().transactional(async (tx) => {
      const message = await tx.findOneOrFail(ErpMessage, id);
      message.attempts += 1;
      message.completedAt = new Date();
      if (failure) {
        message.state = 'FAILED';
        message.lastError = failure;
        this.failed(tx, message);
      } else {
        message.state = 'PROCESSED';
        message.result = result;
        message.lastError = null;
      }
      return message;
    });
  }

  private async apply(message: ErpInboundMessage): Promise<Record<string, unknown>> {
    const data = message.data as Record<string, any>;
    switch (message.type) {
      case 'product': {
        const exists = await this.inventory.getProduct(data['sku']).then(
          () => true,
          (e: unknown) => (e instanceof NotFoundError ? false : Promise.reject(e)),
        );
        if (!exists) {
          await this.inventory.createProduct(CreateProductSchema.parse(data));
          return { sku: data['sku'], created: true };
        }
        const change: Record<string, unknown> = {};
        for (const key of ['description', 'baseUnit', 'overdeliveryAllowed']) if (data[key] !== undefined) change[key] = data[key];
        if (Object.keys(change).length) await this.inventory.updateProduct(data['sku'], change);
        if (data['units']) await this.inventory.replaceUnits(data['sku'], { units: data['units'] });
        return { sku: data['sku'], created: false };
      }
      case 'receiving-order':
        if (message.action === 'cancel') {
          await this.receiving.cancelOrder(data['orderId'], 'Storno aus dem ERP');
          return { orderId: data['orderId'], cancelled: true };
        }
        await this.receiving.create(CreateReceivingOrderSchema.parse({ ...data, positions: (data['positions'] ?? []).map((p: object) => ({ kind: 'quantity', ...p })) }));
        return { orderId: data['orderId'] };
      case 'outbound-order':
        if (message.action === 'cancel') {
          await this.outbound.cancel(data['orderId'], { reason: 'Storno aus dem ERP' });
          return { orderId: data['orderId'], cancelled: true };
        }
        await this.outbound.create(CreateOutboundOrderSchema.parse({ ...data, ...(data['target'] ? { target: { erpCode: data['target'] } } : {}) }));
        return { orderId: data['orderId'] };
    }
  }

  // --- Ausgang ------------------------------------------------------------------------------

  private createOutbound(em: EntityManager, message: Outbound, envelope?: EventEnvelope<unknown>): ErpMessage {
    const id = randomUUID();
    const occurredAt = envelope ? new Date(envelope.occurredAt) : new Date();
    const payload: ErpOutboundMessage = { messageId: id, type: message.type, occurredAt: occurredAt.toISOString(), data: message.data } as ErpOutboundMessage;
    return em.create(ErpMessage, {
      id,
      direction: 'OUT',
      messageId: id,
      type: message.type,
      action: null,
      state: 'PENDING',
      reference: referenceOf(message),
      payload: payload as unknown as Record<string, unknown>,
      nextAttemptAt: occurredAt,
      occurredAt,
    });
  }

  /** Bestandsabgleich: Gesamtbestand je Artikel und Charge als Ausgangsnachricht. */
  snapshot(): Promise<ErpMessage> {
    return this.em.transactional(async (tx) => {
      const items = await this.inventory.stockTotals(tx);
      return this.createOutbound(tx, { type: 'stock-snapshot', data: { takenAt: new Date().toISOString(), items } });
    });
  }

  /**
   * Fällige Ausgangsnachrichten abholen (älteste zuerst). Abgeholte sind `IN_DELIVERY`, bis sie quittiert
   * werden; ohne Quittung innerhalb der Frist (5 min) gelten sie als Fehlversuch und werden erneut ausgeliefert.
   */
  async claim(limit: number, types?: ErpOutboundType[]): Promise<ErpMessage[]> {
    const typeFilter = types?.length ? `and "type" in (${types.map(() => '?').join(', ')})` : '';
    const rows = await this.em.getConnection().execute<{ id: string }[]>(
      `update "erp_message" set
         "attempts" = case when "state" = 'IN_DELIVERY' then "attempts" + 1 else "attempts" end,
         "state" = 'IN_DELIVERY', "lease_until" = now() + (? * interval '1 millisecond'), "updated_at" = now(), "version" = "version" + 1
       where "id" in (
         select "id" from "erp_message"
         where "direction" = 'OUT' ${typeFilter}
           and (("state" = 'PENDING' and "next_attempt_at" <= now()) or ("state" = 'IN_DELIVERY' and "lease_until" < now()))
         order by "occurred_at", "id" limit ? for update skip locked)
       returning "id"`,
      [ERP_LEASE_MS, ...(types ?? []), limit],
    );
    if (!rows.length) return [];
    return this.em.fork().find(ErpMessage, { id: { $in: rows.map((r) => r.id) } }, { orderBy: { occurredAt: 'asc', id: 'asc' } });
  }

  /** Zustellung bestätigt. Wiederholte Quittung ist unschädlich. */
  ack(id: string, erpReference?: string): Promise<ErpMessage> {
    return this.em.fork().transactional(async (tx) => {
      const message = await this.load(tx, id, 'OUT');
      if (message.state === 'SENT') return message;
      if (message.state !== 'IN_DELIVERY') throw new RuleViolationError('ERP_NOT_IN_DELIVERY', `Nachricht ist ${message.state}`, { id, state: message.state });
      message.state = 'SENT';
      message.completedAt = new Date();
      message.leaseUntil = null;
      message.lastError = null;
      message.result = erpReference ? { erpReference } : null;
      this.outbox.record(tx, ErpMessageSentEvent, { id: message.id, messageId: message.messageId, type: message.type, reference: message.reference ?? null, erpReference: erpReference ?? null });
      return message;
    });
  }

  /** Zustellung fehlgeschlagen: später erneut versuchen, nach zu vielen Versuchen FAILED. */
  nack(id: string, error: string): Promise<ErpMessage> {
    return this.em.fork().transactional(async (tx) => {
      const message = await this.load(tx, id, 'OUT');
      if (message.state !== 'IN_DELIVERY') throw new RuleViolationError('ERP_NOT_IN_DELIVERY', `Nachricht ist ${message.state}`, { id, state: message.state });
      message.attempts += 1;
      message.lastError = error;
      message.leaseUntil = null;
      if (message.attempts >= this.config.erp.maxAttempts) {
        message.state = 'FAILED';
        message.nextAttemptAt = null;
        this.failed(tx, message);
      } else {
        message.state = 'PENDING';
        message.nextAttemptAt = new Date(Date.now() + erpRetryDelayMs(message.attempts));
      }
      return message;
    });
  }

  /** Fehlgeschlagene Nachricht erneut anstoßen: Eingang wird neu verarbeitet, Ausgang wieder zur Abholung bereitgestellt. */
  async retry(id: string): Promise<ErpMessage> {
    const message = await this.load(this.em.fork(), id);
    if (message.state !== 'FAILED') throw new RuleViolationError('ERP_NOT_FAILED', `Nur fehlgeschlagene Nachrichten lassen sich wiederholen (ist ${message.state})`, { id, state: message.state });
    if (message.direction === 'IN') return this.process(id);
    return this.em.fork().transactional(async (tx) => {
      const m = await this.load(tx, id);
      m.state = 'PENDING';
      m.attempts = 0;
      m.nextAttemptAt = new Date();
      m.completedAt = null;
      return m;
    });
  }

  // --- Lesen --------------------------------------------------------------------------------

  async list(query: ErpMessageQuery): Promise<{ items: ErpMessage[]; total: number }> {
    const where: FilterQuery<ErpMessage> = {};
    if (query.direction) where.direction = query.direction;
    if (query.state) where.state = { $in: query.state };
    if (query.type) where.type = query.type;
    if (query.reference) where.reference = query.reference;
    const [items, total] = await this.em.findAndCount(ErpMessage, where, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: query.limit, offset: query.offset });
    return { items, total };
  }

  get(id: string): Promise<ErpMessage> {
    return this.load(this.em, id);
  }

  /** Anzahl je Richtung und Zustand (Übersicht im Leitstand). */
  async counts(): Promise<{ direction: string; state: string; count: number }[]> {
    const rows = await this.em.getConnection().execute<{ direction: string; state: string; n: string }[]>(`select direction, state, count(*) as n from erp_message group by direction, state order by direction, state`);
    return rows.map((r) => ({ direction: r.direction, state: r.state, count: Number(r.n) }));
  }

  private async load(em: EntityManager, id: string, direction?: 'IN' | 'OUT'): Promise<ErpMessage> {
    const message = await em.findOne(ErpMessage, { id, ...(direction ? { direction } : {}) });
    if (!message) throw new NotFoundError('ERP_MESSAGE_NOT_FOUND', `ERP-Nachricht [${id}] gibt es nicht`, { id });
    return message;
  }

  private failed(em: EntityManager, message: ErpMessage): void {
    this.outbox.record(em, ErpMessageFailedEvent, { id: message.id, direction: message.direction, messageId: message.messageId, type: message.type, reference: message.reference ?? null, error: message.lastError ?? '' });
  }
}
