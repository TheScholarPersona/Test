import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FlowConfigChangedEvent } from '@wms/shared';
import { ConflictError, DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup, LocationRemovalPolicy } from '../../layout/index.js';
import { PROGRAMS, type ProgramKey } from '../domain/programs.js';
import { FlowAction, FlowRoute, FlowRouteStep } from '../entities/flow.entities.js';
import type { CreateAction, CreateRoute, PlaceSpec, ReplaceSteps, UpdateAction, UpdateRoute } from '../http/schemas.js';

export interface RouteWithSteps {
  route: FlowRoute;
  steps: FlowRouteStep[];
}

/**
 * Pflege von Routen, Schritten und Actions. Es gibt keinen Zwischenspeicher:
 * Jede Anfrage liest die aktuelle Konfiguration, Änderungen wirken sofort
 * (OpenWMS-Schwachstellen R1/R2 entfallen).
 */
@Injectable()
export class FlowConfigService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly locationRemoval: LocationRemovalPolicy,
  ) {}

  onModuleInit(): void {
    this.locationRemoval.register('flow', async (location) => {
      const em = this.em.fork();
      const routes = await em.count(FlowRoute, { $or: [{ sourceLocation: location.id }, { targetLocation: location.id }] });
      const steps = await em.count(FlowRouteStep, { $or: [{ from: location.id }, { next: location.id }] });
      const actions = await em.count(FlowAction, { location: location.id });
      const total = routes + steps + actions;
      return total > 0 ? `Im Materialfluss verwendet (${routes} Routen, ${steps} Schritte, ${actions} Actions)` : null;
    });
  }

  // --- Routen ---------------------------------------------------------------

  async listRoutes(): Promise<RouteWithSteps[]> {
    const routes = await this.em.find(FlowRoute, {}, { orderBy: { routeId: 'asc' }, populate: ['sourceLocation', 'targetLocation'] });
    const steps = await this.em.find(FlowRouteStep, { route: { $in: routes.map((r) => r.id) } }, { orderBy: { pos: 'asc' }, populate: ['from', 'next'] });
    return routes.map((route) => ({ route, steps: steps.filter((s) => (s.route as FlowRoute).id === route.id) }));
  }

  getRoute(routeId: string): Promise<RouteWithSteps> {
    return this.loadRoute(this.em, routeId);
  }

  createRoute(input: CreateRoute): Promise<RouteWithSteps> {
    return this.em.transactional(async (tx) => {
      if (await tx.count(FlowRoute, { routeId: input.routeId })) {
        throw new ConflictError('ROUTE_EXISTS', `Route [${input.routeId}] existiert bereits`, { routeId: input.routeId });
      }
      const source = await this.resolvePlace(tx, input.source);
      const target = await this.resolvePlace(tx, input.target);
      const route = tx.create(FlowRoute, {
        id: randomUUID(),
        routeId: input.routeId,
        description: input.description,
        sourceLocation: source.location,
        sourceGroup: source.group,
        targetLocation: target.location,
        targetGroup: target.group,
        enabled: input.enabled,
      });
      await this.writeSteps(tx, route, input.steps);
      this.changed(tx, 'route', route.routeId, 'created');
      await tx.flush();
      return this.loadRoute(tx, input.routeId);
    });
  }

  updateRoute(routeId: string, input: UpdateRoute): Promise<RouteWithSteps> {
    return this.em.transactional(async (tx) => {
      const { route } = await this.loadRoute(tx, routeId);
      if (input.description !== undefined) route.description = input.description;
      if (input.enabled !== undefined) route.enabled = input.enabled;
      this.changed(tx, 'route', routeId, 'updated');
      await tx.flush();
      return this.loadRoute(tx, routeId);
    });
  }

  /** Ersetzt die Nächster-Schritt-Tabelle einer Route vollständig (Reihenfolge = Position). */
  replaceSteps(routeId: string, input: ReplaceSteps): Promise<RouteWithSteps> {
    return this.em.transactional(async (tx) => {
      const { route } = await this.loadRoute(tx, routeId);
      await tx.nativeDelete(FlowRouteStep, { route: route.id });
      await this.writeSteps(tx, route, input.steps);
      route.updatedAt = new Date();
      this.changed(tx, 'route', routeId, 'updated');
      await tx.flush();
      return this.loadRoute(tx, routeId);
    });
  }

  deleteRoute(routeId: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const { route } = await this.loadRoute(tx, routeId);
      const actions = await tx.find(FlowAction, { route: route.id });
      if (actions.length > 0) {
        throw new RuleViolationError('ROUTE_IN_USE', `Route ${routeId} wird von Actions verwendet: ${actions.map((a) => a.name).join(', ')}`, {
          actions: actions.map((a) => a.name),
        });
      }
      await tx.nativeDelete(FlowRouteStep, { route: route.id });
      tx.remove(route);
      this.changed(tx, 'route', routeId, 'deleted');
    });
  }

  // --- Actions --------------------------------------------------------------

  listActions(): Promise<FlowAction[]> {
    return this.em.find(FlowAction, {}, { orderBy: { eventType: 'asc', name: 'asc' }, populate: ['route', 'location'] });
  }

  createAction(input: CreateAction): Promise<FlowAction> {
    return this.em.transactional(async (tx) => {
      if (await tx.count(FlowAction, { name: input.name })) {
        throw new ConflictError('ACTION_EXISTS', `Action [${input.name}] existiert bereits`, { name: input.name });
      }
      const program = PROGRAMS[input.program];
      if (!(program.events as readonly string[]).includes(input.eventType)) {
        throw new DomainError('invalid', 'PROGRAM_EVENT_MISMATCH', `Programm ${input.program} passt nicht zu Ereignis ${input.eventType} (nur ${program.events.join(', ')})`, {
          program: input.program,
          events: program.events,
        });
      }
      const params = await this.validateParams(tx, input.program, input.params);
      const route = input.routeId ? (await this.loadRoute(tx, input.routeId)).route : null;
      const place = input.place ? await this.resolvePlace(tx, input.place) : { location: null, group: null };
      const action = tx.create(FlowAction, {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        eventType: input.eventType,
        route,
        location: place.location,
        group: place.group,
        program: input.program,
        params,
        enabled: input.enabled,
      });
      this.changed(tx, 'action', action.name, 'created');
      return action;
    });
  }

  updateAction(name: string, input: UpdateAction): Promise<FlowAction> {
    return this.em.transactional(async (tx) => {
      const action = await this.loadAction(tx, name);
      if (input.description !== undefined) action.description = input.description;
      if (input.enabled !== undefined) action.enabled = input.enabled;
      if (input.params !== undefined) action.params = await this.validateParams(tx, action.program as ProgramKey, input.params);
      this.changed(tx, 'action', name, 'updated');
      return action;
    });
  }

  deleteAction(name: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      tx.remove(await this.loadAction(tx, name));
      this.changed(tx, 'action', name, 'deleted');
    });
  }

  // -------------------------------------------------------------------------

  private async validateParams(tx: EntityManager, program: ProgramKey, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = PROGRAMS[program].params.safeParse(raw);
    if (!result.success) {
      throw new DomainError('invalid', 'INVALID_PARAMS', `Parameter passen nicht zu Programm ${program}`, {
        program,
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const params = result.data as Record<string, unknown>;
    // Verweise in den Parametern müssen beim Anlegen existieren.
    if (program === 'send-to') await this.lookup.resolve(tx, (params as { location: never }).location);
    if (program === 'create-order') await this.resolvePlace(tx, (params as { target: PlaceSpec }).target);
    return params;
  }

  private async resolvePlace(tx: EntityManager, spec: PlaceSpec): Promise<{ location: Location | null; group: string | null }> {
    if ('location' in spec) return { location: await this.lookup.resolve(tx, spec.location), group: null };
    await this.lookup.groupPath(tx, spec.group);
    return { location: null, group: spec.group };
  }

  private async writeSteps(tx: EntityManager, route: FlowRoute, steps: CreateRoute['steps']): Promise<void> {
    let pos = 0;
    for (const step of steps) {
      pos += 1;
      const from = await this.lookup.resolve(tx, step.from);
      const next = await this.lookup.resolve(tx, step.next);
      if (from.id === next.id) {
        throw new DomainError('invalid', 'STEP_LOOP', `Schritt ${pos}: Start und nächster Platz sind gleich (${from.locationId})`, { pos });
      }
      tx.create(FlowRouteStep, { id: randomUUID(), route, pos, from, next, unitType: step.unitType ?? null, enabled: step.enabled });
    }
  }

  private async loadRoute(em: EntityManager, routeId: string): Promise<RouteWithSteps> {
    const route = await em.findOne(FlowRoute, { routeId }, { populate: ['sourceLocation', 'targetLocation'] });
    if (!route) throw new NotFoundError('ROUTE_NOT_FOUND', `Route [${routeId}] existiert nicht`, { routeId });
    const steps = await em.find(FlowRouteStep, { route: route.id }, { orderBy: { pos: 'asc' }, populate: ['from', 'next'] });
    return { route, steps };
  }

  private async loadAction(em: EntityManager, name: string): Promise<FlowAction> {
    const action = await em.findOne(FlowAction, { name }, { populate: ['route', 'location'] });
    if (!action) throw new NotFoundError('ACTION_NOT_FOUND', `Action [${name}] existiert nicht`, { name });
    return action;
  }

  private changed(tx: EntityManager, kind: 'route' | 'action', key: string, change: 'created' | 'updated' | 'deleted'): void {
    this.outbox.record(tx, FlowConfigChangedEvent, { kind, key, change });
  }
}
