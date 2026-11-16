import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  MovementCancelledEvent,
  MovementCompletedEvent,
  MovementCreatedEvent,
  MovementReleasedEvent,
  MovementStartedEvent,
} from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup, LocationRemovalPolicy } from '../../layout/index.js';
import { PutawayService } from '../../strategy/index.js';
import { PlacementChecker, type PlacementViolation, type TransportUnit, TransportUnitRemovalPolicy, TransportUnitService } from '../../transport/index.js';
import { ACTIVE_STATES, transition } from '../domain/movement-state.js';
import { Movement, priorityRank } from '../entities/movement.entity.js';
import type { CancelMovement, CompleteMovement, CreateMovement, MovementQuery, StartMovement } from '../http/schemas.js';
import { movementSnapshot } from './mappers.js';

export interface CompletionOutcome {
  movement: Movement;
  violations: PlacementViolation[];
}

const locationRef = (l: Location) => ({ id: l.id, locationId: l.locationId, erpCode: l.erpCode ?? null });

@Injectable()
export class MovementService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly checker: PlacementChecker,
    private readonly units: TransportUnitService,
    private readonly putaway: PutawayService,
    private readonly unitRemoval: TransportUnitRemovalPolicy,
    private readonly locationRemoval: LocationRemovalPolicy,
  ) {}

  /** TUs mit offener Bewegung und Plätze, die Ziel einer offenen Bewegung sind, dürfen nicht gelöscht werden. */
  onModuleInit(): void {
    this.unitRemoval.register('open-movements', async (unit) => {
      const open = await this.em.fork().findOne(Movement, { unit: unit.id, state: { $in: [...ACTIVE_STATES] } });
      return open ? `Offene Lagerbewegung ${open.number}` : null;
    });
    this.locationRemoval.register('open-movements', async (location) => {
      const count = await this.em.fork().count(Movement, { target: location.id, state: { $in: [...ACTIVE_STATES] } });
      return count > 0 ? `Ziel von ${count} offenen Lagerbewegung(en)` : null;
    });
  }

  async list(query: MovementQuery): Promise<{ items: Movement[]; total: number }> {
    const where: FilterQuery<Movement> = {};
    if (query.state) where.state = { $in: query.state };
    if (query.type) where.type = { $in: query.type };
    if (query.barcode) where.barcode = query.barcode;
    if (query.assignedTo) where.assignedTo = query.assignedTo;
    const [items, total] = await this.em.findAndCount(Movement, where, {
      orderBy: { priorityRank: 'asc', createdAt: 'asc', number: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total };
  }

  get(number: string): Promise<Movement> {
    return this.load(this.em, number);
  }

  /**
   * Legt eine Bewegung an und reserviert ihr Ziel (Ziel der TU wird gesetzt).
   * Bei einer Zielgruppe bestimmt die Einlagerstrategie den Platz – in
   * derselben Transaktion, damit Bewegung und Reservierung zusammen gelingen.
   */
  create(input: CreateMovement): Promise<Movement> {
    return this.em.transactional(async (tx) => {
      const unit = await this.units.loadIn(tx, input.barcode);
      if (unit.parent) {
        throw new RuleViolationError('TU_STACKED', `TU ${unit.barcode} steht auf einer anderen TU; die Bewegung gilt der Basis des Stapels`, {
          barcode: unit.barcode,
          parentBarcode: (unit.parent as TransportUnit).barcode,
        });
      }
      const open = await tx.findOne(Movement, { unit, state: { $in: [...ACTIVE_STATES] } });
      if (open) {
        throw new ConflictError('MOVEMENT_EXISTS', `Für TU ${unit.barcode} ist bereits Bewegung ${open.number} offen`, {
          barcode: unit.barcode,
          number: open.number,
        });
      }
      const source = await this.lookup.resolve(tx, { id: (unit.location as Location).id });

      let target: Location;
      let decisionId: string | null = null;
      if ('location' in input.target) {
        target = await this.lookup.resolve(tx, input.target.location, { lock: true });
        if (target.id === source.id) {
          throw new RuleViolationError('TARGET_IS_SOURCE', `TU ${unit.barcode} steht bereits auf ${target.locationId}`, { locationId: target.locationId });
        }
        const prepared = await this.checker.prepareExisting(tx, unit);
        const { violations } = (await this.checker.evaluate(tx, prepared, source, [target], { forAllocation: true })).get(target.id)!;
        if (violations.length > 0) {
          throw new RuleViolationError('PLACEMENT_REJECTED', violations.map((v) => v.message).join('; '), { violations });
        }
        this.units.assignTarget(tx, unit, target);
      } else {
        const decision = await this.putaway.decideIn(tx, {
          barcode: unit.barcode,
          group: input.target.group,
          assign: true,
          movementType: input.type,
        });
        if (!decision.assigned || !decision.chosen) {
          throw new RuleViolationError(
            'NO_TARGET_LOCATION',
            `Kein Zielplatz in [${input.target.group}] gefunden: ${decision.note ?? 'Zuweisung gescheitert'}`,
            { group: input.target.group, summary: decision.summary, rule: decision.rule, strategy: decision.strategy },
          );
        }
        target = await this.lookup.resolve(tx, { id: decision.chosen.key });
        decisionId = decision.id;
      }

      const movement = tx.create(Movement, {
        id: randomUUID(),
        number: await this.nextNumber(tx),
        barcode: unit.barcode,
        unit,
        type: input.type,
        state: 'OPEN',
        priority: input.priority,
        priorityRank: priorityRank(input.priority),
        source,
        sourceCoordinate: source.locationId,
        target,
        targetCoordinate: target.locationId,
        targetGroup: 'group' in input.target ? input.target.group : null,
        decisionId,
        initiator: input.initiator ?? null,
        assignedTo: null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        completedAt: null,
        completedLocation: null,
        completedCoordinate: null,
        deviated: false,
        startedAt: null,
        cancelledAt: null,
        cancelReason: null,
      });
      this.outbox.record(tx, MovementCreatedEvent, { ...movementSnapshot(movement), decisionId });
      return movement;
    });
  }

  start(number: string, input: StartMovement): Promise<Movement> {
    return this.em.transactional(async (tx) => {
      const movement = await this.load(tx, number);
      movement.state = transition(movement.state, 'start', number);
      movement.startedAt = new Date();
      movement.assignedTo = input.assignedTo ?? null;
      this.outbox.record(tx, MovementStartedEvent, movementSnapshot(movement));
      return movement;
    });
  }

  /** Zurückgeben: Bearbeitung abbrechen, Bewegung bleibt offen. */
  release(number: string): Promise<Movement> {
    return this.em.transactional(async (tx) => {
      const movement = await this.load(tx, number);
      movement.state = transition(movement.state, 'release', number);
      movement.assignedTo = null;
      movement.startedAt = null;
      this.outbox.record(tx, MovementReleasedEvent, movementSnapshot(movement));
      return movement;
    });
  }

  /**
   * Abschluss: TU wird (samt Stapel) auf das Ziel oder den angegebenen
   * tatsächlichen Platz gebucht – mit allen Regeln der TU-Buchung.
   */
  complete(number: string, input: CompleteMovement): Promise<CompletionOutcome> {
    return this.em.transactional(async (tx) => {
      const movement = await this.load(tx, number);
      const next = transition(movement.state, 'complete', number);
      const unit = movement.unit as TransportUnit | null;
      if (!unit) {
        throw new RuleViolationError('TU_MISSING', `Die TU ${movement.barcode} der Bewegung existiert nicht mehr`, { number });
      }
      const plannedTarget = movement.target as Location | null;
      const to = input.location ?? (plannedTarget ? { id: plannedTarget.id } : null);
      if (!to) {
        throw new RuleViolationError('NO_TARGET_LOCATION', `Bewegung ${number} hat kein Ziel mehr (Platz gelöscht); bitte Abstellplatz angeben`, { number });
      }
      const result = await this.units.moveIn(tx, movement.barcode, { to, mode: input.mode });
      const reached = result.unit.location as Location;
      const deviated = plannedTarget?.id !== reached.id;
      // Bei Abweichung bleibt sonst die Reservierung des geplanten Ziels bestehen.
      if (deviated && plannedTarget && (result.unit.target as Location | null)?.id === plannedTarget.id) {
        this.units.assignTarget(tx, result.unit, null);
      }
      movement.state = next;
      movement.completedAt = new Date();
      movement.completedLocation = reached;
      movement.completedCoordinate = reached.locationId;
      movement.deviated = deviated;
      this.outbox.record(tx, MovementCompletedEvent, {
        ...movementSnapshot(movement),
        from: locationRef(result.from),
        to: locationRef(reached),
        deviated,
        mode: input.mode,
        violations: result.violations,
      });
      return { movement, violations: result.violations };
    });
  }

  /** Storno: gibt den reservierten Zielplatz wieder frei. */
  cancel(number: string, input: CancelMovement): Promise<Movement> {
    return this.em.transactional(async (tx) => {
      const movement = await this.load(tx, number);
      movement.state = transition(movement.state, 'cancel', number);
      // TU vollständig laden (Typ, Platz), damit das Änderungs-Event der TU vollständig ist.
      const unit = movement.unit ? await this.units.loadIn(tx, movement.barcode) : null;
      const target = movement.target as Location | null;
      const releasedTarget = !!unit && !!target && (unit.target as Location | null)?.id === target.id;
      if (releasedTarget) {
        this.units.assignTarget(tx, unit!, null);
      }
      movement.cancelledAt = new Date();
      movement.cancelReason = input.reason ?? null;
      this.outbox.record(tx, MovementCancelledEvent, {
        ...movementSnapshot(movement),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        releasedTarget,
      });
      return movement;
    });
  }

  private async load(em: EntityManager, number: string): Promise<Movement> {
    const movement = await em.findOne(Movement, { number }, { populate: ['unit', 'source', 'target', 'completedLocation'] });
    if (!movement) {
      throw new NotFoundError('MOVEMENT_NOT_FOUND', `Lagerbewegung [${number}] existiert nicht`, { number });
    }
    return movement;
  }

  private async nextNumber(em: EntityManager): Promise<string> {
    const [row] = await em.execute<{ n: string }[]>(`select nextval('movement_number_seq') as n`);
    return `MV${String(row!.n).padStart(8, '0')}`;
  }
}
