import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { MovementGroupChangedEvent, MovementGroupCreatedEvent } from '@wms/shared';
import { ConflictError, NotFoundError } from '../../../common/domain-error.js';
import { requestContext } from '../../../common/request-context.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { ACTIVE_STATES } from '../domain/movement-state.js';
import { MovementGroup } from '../entities/movement-group.entity.js';
import { Movement } from '../entities/movement.entity.js';
import type { AssignMovementGroup, ChangeMovementGroup, CreateMovementGroup, MovementGroupQuery, StartMovementGroup } from '../http/schemas.js';
import { MovementService } from './movement.service.js';

export type MovementGroupState = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export interface LoadedGroup {
  group: MovementGroup;
  movements: Movement[];
}

/** Zustand der Gruppe aus ihren Bewegungen: läuft eine, ist sie in Arbeit; sind alle beendet, ist sie erledigt. */
export function groupState(movements: { state: string }[]): MovementGroupState {
  if (movements.some((m) => m.state === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (movements.some((m) => m.state === 'OPEN') || movements.length === 0) return 'OPEN';
  return movements.some((m) => m.state === 'DONE') ? 'DONE' : 'CANCELLED';
}

const actor = (): string | null => requestContext.get()?.actor ?? null;
/** `user:anna` → `anna`; Service-Tokens behalten ihr Präfix. */
const operatorOf = (a: string | null): string | null => (a?.startsWith('user:') ? a.slice(5) : a);

/**
 * Bewegungsgruppen: Lagerbewegungen bündeln und einem Bediener zuteilen. Beginnen und
 * Zurückgeben wirken auf alle passenden Bewegungen der Gruppe; Abschließen und Stornieren
 * bleiben je Bewegung, weil jede TU einzeln am Ziel ankommt.
 */
@Injectable()
export class MovementGroupService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly movements: MovementService,
  ) {}

  create(input: CreateMovementGroup): Promise<LoadedGroup> {
    return this.em.transactional(async (tx) => {
      const [row] = await tx.execute<{ n: string }[]>(`select nextval('movement_group_number_seq') as n`);
      const group = tx.create(MovementGroup, {
        id: randomUUID(),
        number: `MG${String(row!.n).padStart(8, '0')}`,
        description: input.description ?? null,
        assignedTo: input.assignedTo ?? null,
        createdBy: actor(),
      });
      const members = await this.join(tx, group, input.movements);
      this.outbox.record(tx, MovementGroupCreatedEvent, snapshot({ group, movements: members }));
      return { group, movements: members };
    });
  }

  async get(number: string): Promise<LoadedGroup> {
    return this.load(this.em, number);
  }

  async list(query: MovementGroupQuery): Promise<{ items: LoadedGroup[]; total: number }> {
    const groups = await this.em.find(MovementGroup, query.assignedTo ? { assignedTo: query.assignedTo } : {}, { orderBy: { createdAt: 'desc', number: 'desc' } });
    const members = groups.length ? await this.em.find(Movement, { group: { $in: groups.map((g) => g.id) } }, { populate: ['source', 'target', 'group'], orderBy: { priorityRank: 'asc', createdAt: 'asc', number: 'asc' } }) : [];
    const loaded = groups.map((group) => ({ group, movements: members.filter((m) => (m.group as MovementGroup | null)?.id === group.id) }));
    const filtered = query.state ? loaded.filter((g) => query.state!.includes(groupState(g.movements))) : loaded;
    return { items: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length };
  }

  change(number: string, input: ChangeMovementGroup): Promise<LoadedGroup> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.load(tx, number, true);
      if (input.add?.length || input.remove?.length) this.assertOpen(loaded);
      if (input.remove?.length) {
        for (const n of input.remove) {
          const m = loaded.movements.find((x) => x.number === n);
          if (!m) throw new NotFoundError('MOVEMENT_NOT_IN_GROUP', `Lagerbewegung ${n} gehört nicht zur Gruppe ${number}`, { number, movement: n });
          m.group = null;
        }
        loaded.movements = loaded.movements.filter((m) => !input.remove!.includes(m.number));
      }
      if (input.add?.length) loaded.movements.push(...(await this.join(tx, loaded.group, input.add)));
      if (input.description !== undefined) loaded.group.description = input.description;
      this.outbox.record(tx, MovementGroupChangedEvent, { ...snapshot(loaded), change: input.add?.length || input.remove?.length ? 'members' : 'description' });
      return loaded;
    });
  }

  assign(number: string, input: AssignMovementGroup): Promise<LoadedGroup> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.load(tx, number, true);
      this.assertOpen(loaded);
      loaded.group.assignedTo = input.assignedTo;
      // Laufende Bewegungen wechseln mit zum neuen Bediener.
      for (const m of loaded.movements) if (m.state === 'IN_PROGRESS' && input.assignedTo) m.assignedTo = input.assignedTo;
      this.outbox.record(tx, MovementGroupChangedEvent, { ...snapshot(loaded), change: 'assigned' });
      return loaded;
    });
  }

  /** Alle offenen Bewegungen der Gruppe beginnen – für den zugeteilten Bediener bzw. den Angemeldeten. */
  start(number: string, input: StartMovementGroup): Promise<LoadedGroup> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.load(tx, number, true);
      const open = loaded.movements.filter((m) => m.state === 'OPEN');
      if (open.length === 0) throw new ConflictError('NOTHING_TO_START', `Gruppe ${number} hat keine offenen Bewegungen`, { number });
      const operator = input.assignedTo ?? loaded.group.assignedTo ?? operatorOf(actor());
      loaded.group.assignedTo = operator;
      for (const m of open) this.movements.startIn(tx, m, operator);
      this.outbox.record(tx, MovementGroupChangedEvent, { ...snapshot(loaded), change: 'started' });
      return loaded;
    });
  }

  /** Zurückgeben: laufende Bewegungen wieder öffnen und die Zuteilung aufheben. */
  release(number: string): Promise<LoadedGroup> {
    return this.em.transactional(async (tx) => {
      const loaded = await this.load(tx, number, true);
      const running = loaded.movements.filter((m) => m.state === 'IN_PROGRESS');
      if (running.length === 0) throw new ConflictError('NOTHING_TO_RELEASE', `Gruppe ${number} hat keine laufenden Bewegungen`, { number });
      for (const m of running) this.movements.releaseIn(tx, m);
      loaded.group.assignedTo = null;
      this.outbox.record(tx, MovementGroupChangedEvent, { ...snapshot(loaded), change: 'released' });
      return loaded;
    });
  }

  // -------------------------------------------------------------------------

  /** Nimmt Bewegungen in die Gruppe auf: nur offene oder laufende, die noch in keiner Gruppe sind. */
  private async join(tx: EntityManager, group: MovementGroup, numbers: string[]): Promise<Movement[]> {
    const unique = [...new Set(numbers)];
    const found = await tx.find(Movement, { number: { $in: unique } }, { populate: ['source', 'target', 'group'] });
    for (const n of unique) {
      const m = found.find((x) => x.number === n);
      if (!m) throw new NotFoundError('MOVEMENT_NOT_FOUND', `Lagerbewegung [${n}] existiert nicht`, { number: n });
      if (!(ACTIVE_STATES as readonly string[]).includes(m.state)) throw new ConflictError('MOVEMENT_CLOSED', `Lagerbewegung ${n} ist bereits ${m.state}`, { number: n, state: m.state });
      const current = m.group as MovementGroup | null;
      if (current && current.id !== group.id) throw new ConflictError('MOVEMENT_GROUPED', `Lagerbewegung ${n} gehört schon zur Gruppe ${current.number}`, { number: n, group: current.number });
      m.group = group;
    }
    return unique.map((n) => found.find((x) => x.number === n)!);
  }

  private assertOpen(loaded: LoadedGroup): void {
    const state = groupState(loaded.movements);
    if (loaded.movements.length > 0 && (state === 'DONE' || state === 'CANCELLED')) {
      throw new ConflictError('GROUP_CLOSED', `Gruppe ${loaded.group.number} ist abgeschlossen (${state})`, { number: loaded.group.number, state });
    }
  }

  private async load(em: EntityManager, number: string, lock = false): Promise<LoadedGroup> {
    const group = await em.findOne(MovementGroup, { number });
    if (!group) throw new NotFoundError('MOVEMENT_GROUP_NOT_FOUND', `Bewegungsgruppe [${number}] existiert nicht`, { number });
    // Gruppenzeile sperren, damit gleichzeitige Änderungen nacheinander laufen.
    if (lock) await em.execute('select "id" from "movement_group" where "id" = ? for update', [group.id]);
    const movements = await em.find(Movement, { group: group.id }, { populate: ['unit', 'source', 'target', 'group'], orderBy: { priorityRank: 'asc', createdAt: 'asc', number: 'asc' } });
    return { group, movements };
  }
}

export function snapshot({ group, movements }: LoadedGroup) {
  return {
    number: group.number,
    description: group.description ?? null,
    assignedTo: group.assignedTo ?? null,
    state: groupState(movements),
    movements: movements.map((m) => m.number),
  };
}
