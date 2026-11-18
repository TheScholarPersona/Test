import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  TransportOrderCanceledEvent,
  TransportOrderCreatedEvent,
  TransportOrderFailedEvent,
  TransportOrderFinishedEvent,
  TransportOrderInterruptedEvent,
  TransportOrderResumedEvent,
  TransportOrderStartBlockedEvent,
  TransportOrderStartedEvent,
} from '@wms/shared';
import { DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup, LocationRemovalPolicy } from '../../layout/index.js';
import { PutawayService } from '../../strategy/index.js';
import { PlacementChecker, type TransportUnit, TransportUnitClaims, TransportUnitRemovalPolicy, TransportUnitService } from '../../transport/index.js';
import { ACTIVE_STATES, OPEN_STATES, priorityRank, transition } from '../domain/transport-order-state.js';
import { TransportOrder } from '../entities/transport-order.entity.js';
import type { CreateTransportOrder, FailInput, FinishInput, ReasonInput, TransportOrderQuery } from '../http/schemas.js';
import { historicRef, transportOrderSnapshot } from './mappers.js';

/** Grund, warum ein Auftrag (noch) nicht starten kann. */
export interface StartProblem {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

type StartOutcome = { started: true } | { started: false; problem: StartProblem };

const CLAIM = 'transport-order';
const POPULATE = ['unit', 'source', 'target'] as const;
/** Startreihenfolge (O-05): Priorität, dann Anlagezeit, dann Nummer. */
const START_ORDER = { priorityRank: 'asc', createdAt: 'asc', number: 'asc' } as const;

@Injectable()
export class TransportOrderService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly checker: PlacementChecker,
    private readonly units: TransportUnitService,
    private readonly putaway: PutawayService,
    private readonly claims: TransportUnitClaims,
    private readonly unitRemoval: TransportUnitRemovalPolicy,
    private readonly locationRemoval: LocationRemovalPolicy,
  ) {}

  onModuleInit(): void {
    this.claims.register(CLAIM, async (em, unit) => {
      const active = await em.findOne(TransportOrder, { unit: unit.id, state: { $in: [...ACTIVE_STATES] } });
      return active ? `laufender Transportauftrag ${active.number}` : null;
    });
    this.unitRemoval.register('transport-orders', async (unit, em) => {
      const open = await em.count(TransportOrder, { unit: unit.id, state: { $in: [...OPEN_STATES] } });
      return open > 0 ? `${open} offene(r) Transportauftrag/-aufträge` : null;
    });
    this.locationRemoval.register('transport-orders', async (location) => {
      const open = await this.em.fork().count(TransportOrder, { target: location.id, state: { $in: [...OPEN_STATES] } });
      return open > 0 ? `Ziel von ${open} offenen Transportauftrag/-aufträgen` : null;
    });
  }

  async list(query: TransportOrderQuery): Promise<{ items: TransportOrder[]; total: number }> {
    const where: FilterQuery<TransportOrder> = {};
    if (query.state) where.state = { $in: query.state };
    if (query.barcode) where.barcode = query.barcode;
    const [items, total] = await this.em.findAndCount(TransportOrder, where, { orderBy: START_ORDER, limit: query.limit, offset: query.offset, populate: POPULATE });
    return { items, total };
  }

  get(number: string): Promise<TransportOrder> {
    return this.load(this.em, number);
  }

  /** Gestarteter oder unterbrochener Auftrag einer TU (für den Materialfluss). */
  activeFor(em: EntityManager, barcode: string): Promise<TransportOrder | null> {
    return em.findOne(TransportOrder, { barcode, state: { $in: [...ACTIVE_STATES] } }, { populate: POPULATE });
  }

  /** Legt einen Auftrag an (O-01: TU und Ziel sind Pflicht) und startet ihn auf Wunsch sofort. */
  create(input: CreateTransportOrder): Promise<TransportOrder> {
    return this.em.transactional((tx) => this.createIn(tx, input));
  }

  async createIn(tx: EntityManager, input: CreateTransportOrder): Promise<TransportOrder> {
    const unit = await this.units.loadIn(tx, input.barcode);
    await this.units.lockRow(tx, unit);
    const source = await this.lookup.resolve(tx, { id: (unit.location as Location).id });
    let target: Location | null = null;
    let targetGroup: string | null = null;
    if ('location' in input.target) {
      target = await this.lookup.resolve(tx, input.target.location);
      if (target.id === source.id) {
        throw new RuleViolationError('TARGET_IS_SOURCE', `TU ${unit.barcode} steht bereits auf ${target.locationId}`, { locationId: target.locationId });
      }
    } else {
      await this.lookup.groupPath(tx, input.target.group);
      targetGroup = input.target.group;
    }
    const order = tx.create(TransportOrder, {
      id: randomUUID(),
      number: await this.nextNumber(tx),
      barcode: unit.barcode,
      unit,
      state: 'INITIALIZED',
      priority: input.priority,
      priorityRank: priorityRank(input.priority),
      source,
      sourceCoordinate: source.locationId,
      target,
      targetCoordinate: target?.locationId ?? null,
      targetGroup,
      redirect: input.redirect,
      decisionId: null,
      initiator: input.initiator ?? null,
      problemCode: null,
      problemMessage: null,
      problemAt: null,
      startedAt: null,
      finishedAt: null,
      finishedCoordinate: null,
      deviated: false,
      endedAt: null,
      endReason: null,
    });
    this.outbox.record(tx, TransportOrderCreatedEvent, transportOrderSnapshot(order));
    if (input.autoStart) {
      await tx.flush();
      // Nur starten, wenn kein anderer Auftrag der TU wartet, der laut Reihenfolge (O-05) vorher dran ist.
      await this.startNext(tx, unit);
    }
    return order;
  }

  /** Expliziter Start; wirft mit dem Grund, wenn es nicht geht. */
  start(number: string): Promise<TransportOrder> {
    return this.em.transactional(async (tx) => {
      const order = await this.load(tx, number);
      transition(order.state, 'start', number);
      const outcome = await this.tryStart(tx, order);
      if (!outcome.started) {
        throw new DomainError('rule-violation', outcome.problem.code, outcome.problem.message, { number, ...outcome.problem.details });
      }
      return order;
    });
  }

  /**
   * Versucht für jede TU ohne laufenden Auftrag den nächsten wartenden zu
   * starten (z. B. nachdem ein Ziel entsperrt wurde). Jede TU in einer eigenen
   * Transaktion, damit ein Fehler die anderen nicht zurückrollt.
   */
  async startPending(): Promise<{ started: string[]; blocked: { number: string; code: string; message: string }[] }> {
    const waiting = await this.em.fork().find(TransportOrder, { state: 'INITIALIZED', unit: { $ne: null } }, { orderBy: START_ORDER });
    const unitIds = [...new Set(waiting.map((o) => (o.unit as TransportUnit).id))];
    const started: string[] = [];
    const blocked: { number: string; code: string; message: string }[] = [];
    for (const unitId of unitIds) {
      await this.em.fork().transactional(async (tx) => {
        const result = await this.startNext(tx, { id: unitId });
        if (result?.state === 'STARTED') started.push(result.number);
        else if (result?.problemCode) blocked.push({ number: result.number, code: result.problemCode, message: result.problemMessage ?? '' });
      });
    }
    return { started, blocked };
  }

  interrupt(number: string, input: ReasonInput): Promise<TransportOrder> {
    return this.em.transactional(async (tx) => {
      const order = await this.load(tx, number);
      order.state = transition(order.state, 'interrupt', number);
      this.setProblem(order, { code: 'INTERRUPTED', message: input.reason ?? 'Unterbrochen' });
      this.outbox.record(tx, TransportOrderInterruptedEvent, transportOrderSnapshot(order));
      return order;
    });
  }

  resume(number: string): Promise<TransportOrder> {
    return this.em.transactional(async (tx) => {
      const order = await this.load(tx, number);
      order.state = transition(order.state, 'resume', number);
      this.clearProblem(order);
      this.outbox.record(tx, TransportOrderResumedEvent, transportOrderSnapshot(order));
      return order;
    });
  }

  finish(number: string, input: FinishInput): Promise<TransportOrder> {
    return this.em.transactional((tx) => this.finishIn(tx, number, input));
  }

  /**
   * Abschluss: TU auf den tatsächlichen Platz buchen (falls sie nicht schon
   * dort steht), danach den nächsten wartenden Auftrag der TU starten (O-06).
   */
  async finishIn(tx: EntityManager, number: string, input: FinishInput): Promise<TransportOrder> {
    const order = await this.load(tx, number);
    const next = transition(order.state, 'finish', number);
    const unit = order.unit as TransportUnit | null;
    if (!unit) {
      throw new RuleViolationError('TU_MISSING', `Die TU ${order.barcode} des Auftrags existiert nicht mehr`, { number });
    }
    const planned = order.target as Location | null;
    const current = await this.units.loadIn(tx, order.barcode);
    const to = input.location ?? (planned ? { id: planned.id } : { id: (current.location as Location).id });
    const { unit: moved } = await this.units.moveIn(tx, order.barcode, { to, mode: input.mode });
    const reached = await this.lookup.resolve(tx, { id: (moved.location as Location).id });
    const deviated = planned ? planned.id !== reached.id : !this.lookup.groupPathOf(reached).includes(order.targetGroup!);
    if (planned && deviated && (moved.target as Location | null)?.id === planned.id) {
      this.units.assignTarget(tx, moved, null);
    }
    order.state = next;
    order.finishedAt = new Date();
    order.finishedCoordinate = reached.locationId;
    order.deviated = deviated;
    this.clearProblem(order);
    this.outbox.record(tx, TransportOrderFinishedEvent, { ...transportOrderSnapshot(order), to: historicRef(reached, reached.locationId), deviated });
    await tx.flush();
    await this.startNext(tx, unit);
    return order;
  }

  cancel(number: string, input: ReasonInput): Promise<TransportOrder> {
    return this.em.transactional(async (tx) => {
      const order = await this.load(tx, number);
      const wasActive = ACTIVE_STATES.includes(order.state);
      order.state = transition(order.state, 'cancel', number);
      const releasedTarget = wasActive ? await this.releaseTarget(tx, order) : false;
      order.endedAt = new Date();
      order.endReason = input.reason ?? null;
      this.outbox.record(tx, TransportOrderCanceledEvent, { ...transportOrderSnapshot(order), reason: input.reason ?? null, releasedTarget });
      await this.afterEnd(tx, order, wasActive);
      return order;
    });
  }

  /** Auftrag scheitert (z. B. Anlagenfehler), mit Fehlercode und Grund. */
  fail(number: string, input: FailInput): Promise<TransportOrder> {
    return this.em.transactional((tx) => this.failIn(tx, number, input));
  }

  async failIn(tx: EntityManager, number: string, input: FailInput): Promise<TransportOrder> {
    const order = await this.load(tx, number);
    const wasActive = ACTIVE_STATES.includes(order.state);
    order.state = transition(order.state, 'fail', number);
    const releasedTarget = wasActive ? await this.releaseTarget(tx, order) : false;
    order.endedAt = new Date();
    order.endReason = input.reason;
    this.setProblem(order, { code: input.code, message: input.reason });
    this.outbox.record(tx, TransportOrderFailedEvent, { ...transportOrderSnapshot(order), releasedTarget });
    await this.afterEnd(tx, order, wasActive);
    return order;
  }

  /** Unterbricht den laufenden Auftrag innerhalb einer Transaktion (z. B. Anlagenstörung). */
  interruptIn(tx: EntityManager, order: TransportOrder, reason: string): void {
    order.state = transition(order.state, 'interrupt', order.number);
    this.setProblem(order, { code: 'INTERRUPTED', message: reason });
    this.outbox.record(tx, TransportOrderInterruptedEvent, transportOrderSnapshot(order));
  }

  // -------------------------------------------------------------------------

  /**
   * Startet den nächsten wartenden Auftrag der TU (O-05, O-06), sofern keiner
   * läuft. Gelingt der Start nicht, bleibt er INITIALIZED und bekommt den Grund
   * als Problem. Liefert den betrachteten Auftrag oder `null`.
   */
  private async startNext(tx: EntityManager, unit: { id: string }): Promise<TransportOrder | null> {
    await this.units.lockRow(tx, unit);
    if (await tx.count(TransportOrder, { unit: unit.id, state: { $in: [...ACTIVE_STATES] } })) return null;
    const next = await tx.findOne(TransportOrder, { unit: unit.id, state: 'INITIALIZED' }, { orderBy: START_ORDER, populate: POPULATE });
    if (!next) return null;
    const outcome = await this.tryStart(tx, next);
    if (!outcome.started) {
      this.setProblem(next, outcome.problem);
      this.outbox.record(tx, TransportOrderStartBlockedEvent, transportOrderSnapshot(next));
    }
    return next;
  }

  /** Prüft die Startbedingungen und startet; Fachgründe werden zurückgegeben, nicht geworfen. */
  private async tryStart(tx: EntityManager, order: TransportOrder): Promise<StartOutcome> {
    const blocked = (problem: StartProblem): StartOutcome => ({ started: false, problem });
    if (!order.unit) return blocked({ code: 'TU_MISSING', message: `Die TU ${order.barcode} existiert nicht mehr` });
    const unit = await this.units.loadIn(tx, order.barcode);
    await this.units.lockRow(tx, unit);

    // O-02: höchstens ein laufender Auftrag je TU.
    const other = await tx.findOne(TransportOrder, { unit: unit.id, state: { $in: [...ACTIVE_STATES] }, id: { $ne: order.id } });
    if (other) {
      return blocked({ code: 'TRANSPORT_ORDER_ACTIVE', message: `Für TU ${unit.barcode} läuft bereits Auftrag ${other.number}`, details: { active: other.number } });
    }
    const claims = await this.claims.claims(tx, unit, CLAIM);
    if (claims.length > 0) {
      return blocked({ code: 'TU_CLAIMED', message: `TU ${unit.barcode} ist belegt: ${claims.map((c) => c.description).join('; ')}`, details: { claims } });
    }
    if (unit.parent) {
      return blocked({ code: 'TU_STACKED', message: `TU ${unit.barcode} steht auf ${(unit.parent as TransportUnit).barcode}` });
    }

    let redirectedFrom: Location | null = null;
    if (order.targetGroup) {
      // O-04 für Zielgruppen.
      const lock = (await this.lookup.groupLocks(tx, order.targetGroup)).inbound;
      if (lock.blocked) {
        return blocked({ code: 'TARGET_LOCKED', message: `Zielgruppe ${order.targetGroup} ist für Einlagerung gesperrt (durch ${lock.blockedBy?.name})`, details: { blockedBy: lock.blockedBy } });
      }
    } else {
      const planned = order.target as Location | null;
      if (!planned) return blocked({ code: 'NO_TARGET_LOCATION', message: 'Der Zielplatz wurde gelöscht' });
      const target = await this.lookup.resolve(tx, { id: planned.id }, { lock: true });
      const problem = await this.targetProblem(tx, unit, target);
      if (problem) {
        if (!order.redirect) return blocked(problem);
        // O-07: Umleitung auf einen Ersatzplatz der Gruppe des Zielplatzes per Einlagerstrategie.
        const group = this.lookup.groupName(target);
        const decision = await this.putaway.decideIn(tx, { barcode: unit.barcode, group, assign: true });
        if (!decision.assigned || !decision.chosen) {
          return blocked({
            code: problem.code,
            message: `${problem.message}; keine Umleitung in ${group} möglich: ${decision.note ?? 'kein Ersatzplatz'}`,
            details: { ...problem.details, redirect: { group, decisionId: decision.id, summary: decision.summary } },
          });
        }
        redirectedFrom = target;
        const replacement = await this.lookup.resolve(tx, { id: decision.chosen.key });
        order.target = replacement;
        order.targetCoordinate = replacement.locationId;
        order.decisionId = decision.id;
      } else {
        this.units.assignTarget(tx, unit, target);
      }
    }

    order.state = transition(order.state, 'start', order.number);
    order.startedAt = new Date();
    this.clearProblem(order);
    this.outbox.record(tx, TransportOrderStartedEvent, {
      ...transportOrderSnapshot(order),
      redirectedFrom: redirectedFrom ? historicRef(redirectedFrom, redirectedFrom.locationId) : null,
      decisionId: order.decisionId ?? null,
    });
    return { started: true };
  }

  /** O-04: Zielplatz nicht für Einlagerung gesperrt; dazu die harten Platzregeln (Kapazität, Gewicht, Platzierung). */
  private async targetProblem(tx: EntityManager, unit: TransportUnit, target: Location): Promise<StartProblem | null> {
    const lock = this.lookup.locks(target).inbound;
    if (lock.blocked) {
      return {
        code: 'TARGET_LOCKED',
        message: `Zielplatz ${target.locationId} ist für Einlagerung gesperrt (durch ${lock.blockedBy?.name})`,
        details: { locationId: target.locationId, blockedBy: lock.blockedBy },
      };
    }
    const prepared = await this.checker.prepareExisting(tx, unit);
    const source = unit.location as Location;
    const { violations } = (await this.checker.evaluate(tx, prepared, source, [target], { forAllocation: true })).get(target.id)!;
    const relevant = violations.filter((v) => v.rule !== 'TARGET_INBOUND_BLOCKED');
    if (relevant.length > 0) {
      return { code: 'PLACEMENT_REJECTED', message: relevant.map((v) => v.message).join('; '), details: { locationId: target.locationId, violations: relevant } };
    }
    return null;
  }

  private async releaseTarget(tx: EntityManager, order: TransportOrder): Promise<boolean> {
    const target = order.target as Location | null;
    if (!order.unit || !target) return false;
    const unit = await this.units.loadIn(tx, order.barcode);
    if ((unit.target as Location | null)?.id !== target.id) return false;
    this.units.assignTarget(tx, unit, null);
    return true;
  }

  private async afterEnd(tx: EntityManager, order: TransportOrder, wasActive: boolean): Promise<void> {
    if (!wasActive || !order.unit) return;
    await tx.flush();
    await this.startNext(tx, order.unit as TransportUnit);
  }

  private setProblem(order: TransportOrder, problem: StartProblem): void {
    order.problemCode = problem.code;
    order.problemMessage = problem.message.slice(0, 500);
    order.problemAt = new Date();
  }

  private clearProblem(order: TransportOrder): void {
    order.problemCode = null;
    order.problemMessage = null;
    order.problemAt = null;
  }

  private async load(em: EntityManager, number: string): Promise<TransportOrder> {
    const order = await em.findOne(TransportOrder, { number }, { populate: POPULATE });
    if (!order) {
      throw new NotFoundError('TRANSPORT_ORDER_NOT_FOUND', `Transportauftrag [${number}] existiert nicht`, { number });
    }
    return order;
  }

  private async nextNumber(em: EntityManager): Promise<string> {
    const [row] = await em.execute<{ n: string }[]>(`select nextval('transport_order_number_seq') as n`);
    return `TO${String(row!.n).padStart(8, '0')}`;
  }
}
