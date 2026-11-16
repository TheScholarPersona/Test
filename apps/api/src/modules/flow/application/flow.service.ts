import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { FlowCommandEvent, FlowNoRouteEvent, FlowProgramRequestedEvent, FlowUnhandledEvent } from '@wms/shared';
import { DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup, LocationService } from '../../layout/index.js';
import { type TransportOrder, TransportOrderService } from '../../transport-order/index.js';
import { type TransportUnit, type TransportUnitType, TransportUnitService } from '../../transport/index.js';
import { bestAction, bestRoute, candidates, type PlaceKey, placeLabel } from '../domain/matching.js';
import { PROGRAMS, type ProgramKey, type ProgramParams } from '../domain/programs.js';
import { FlowAction, FlowDecision, type FlowOutcome, FlowRoute, FlowRouteStep } from '../entities/flow.entities.js';
import type { DeviceEvent, ManualCommand } from '../http/schemas.js';

export interface FlowResult {
  decision: FlowDecision;
  command: { barcode: string; from: Location; to: Location } | null;
  dryRun: boolean;
}

interface Context {
  tx: EntityManager;
  event: DeviceEvent;
  decisionId: string;
  location: Location;
  groupPath: string[];
  unit: TransportUnit | null;
  order: TransportOrder | null;
  route: FlowRoute | null;
  trace: string[];
}

interface ProgramResult {
  outcome: FlowOutcome;
  next?: Location;
}

/** Signalisiert das Zurückrollen eines Probelaufs, trägt das Ergebnis heraus. */
class DryRunRollback extends Error {
  constructor(readonly result: FlowResult) {
    super('dry-run');
  }
}

const keyOf = (location: Location | null | undefined, group: string | null | undefined): PlaceKey =>
  location ? { kind: 'location', id: location.id } : { kind: 'group', name: group! };

/**
 * Materialfluss: verarbeitet Geräte-Ereignisse („TU X steht an Platz Y“).
 *
 * 1. Laufenden Transportauftrag der TU suchen, 2. Route für dessen Quelle und
 * Ziel suchen, 3. Action für (Ereignis, Route, Ort) suchen, 4. Programm
 * ausführen. Jede Verarbeitung wird mit Begründung gespeichert; „keine Route“
 * und „keine Action“ sind eigene Ergebnisse mit eigenem Event (R4).
 */
@Injectable()
export class FlowService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly locations: LocationService,
    private readonly units: TransportUnitService,
    private readonly orders: TransportOrderService,
  ) {}

  async handle(event: DeviceEvent): Promise<FlowResult> {
    try {
      return await this.em.transactional(async (tx) => {
        const result = await this.process(tx, event);
        if (event.dryRun) throw new DryRunRollback(result);
        return result;
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result;
      throw error;
    }
  }

  /** Fahrbefehl von außen, z. B. Antwort eines Node-RED-Programms. */
  command(input: ManualCommand): Promise<FlowResult> {
    return this.em.transactional(async (tx) => {
      const unit = await this.units.loadIn(tx, input.barcode);
      const from = await this.lookup.resolve(tx, { id: (unit.location as Location).id });
      const to = await this.lookup.resolve(tx, input.to);
      const order = await this.orders.activeFor(tx, unit.barcode);
      const decision = this.saveDecision(tx, randomUUID(), {
        eventType: 'request',
        event: { barcode: unit.barcode, deviceId: input.deviceId },
        location: from,
        order,
        route: null,
        action: null,
        program: 'command',
        outcome: 'COMMAND',
        next: to,
        trace: [`Fahrbefehl von außen${input.reason ? ` (${input.reason})` : ''}: ${from.locationId} → ${to.locationId}`],
      });
      this.publishCommand(tx, decision, unit.barcode, input.deviceId ?? null, order, null, from, to);
      return { decision, command: { barcode: unit.barcode, from, to }, dryRun: false };
    });
  }

  listDecisions(barcode: string | undefined, limit: number, offset: number): Promise<[FlowDecision[], number]> {
    return this.em.findAndCount(FlowDecision, barcode ? { barcode } : {}, { orderBy: { createdAt: 'desc', id: 'asc' }, limit, offset });
  }

  // -------------------------------------------------------------------------

  private async process(tx: EntityManager, event: DeviceEvent): Promise<FlowResult> {
    const decisionId = randomUUID();
    const trace: string[] = [];
    const location = await this.lookup.resolve(tx, event.location);
    const groupPath = this.lookup.groupPathOf(location);
    trace.push(`Ereignis ${event.type} an ${location.locationId}${location.plcCode ? ` (${location.plcCode})` : ''}, Gruppen ${groupPath.join(' › ')}`);

    const unit = event.barcode ? await this.findUnit(tx, event.barcode) : null;
    if (event.barcode) trace.push(unit ? `TU ${unit.barcode} (${(unit.type as TransportUnitType).code}) steht auf ${(unit.location as Location).locationId}` : `TU ${event.barcode} ist unbekannt`);
    const order = event.barcode ? await this.orders.activeFor(tx, event.barcode) : null;
    if (event.barcode) trace.push(order ? `Laufender Transportauftrag ${order.number} (${order.state})` : 'Kein laufender Transportauftrag');

    const ctx: Context = { tx, event, decisionId, location, groupPath, unit, order, route: null, trace };
    if (order) await this.selectRoute(ctx);

    const action = await this.selectAction(ctx);
    let result: ProgramResult;
    if (!action) {
      result = { outcome: 'NO_ACTION' };
    } else {
      result = await this.runProgram(ctx, action);
    }

    const finalOrder = ctx.order;
    const decision = this.saveDecision(tx, decisionId, {
      eventType: event.type,
      event,
      location,
      order: finalOrder,
      route: ctx.route,
      action,
      program: action?.program ?? null,
      outcome: result.outcome,
      next: result.next ?? null,
      trace,
    });

    if (finalOrder && !ctx.route) {
      this.outbox.record(tx, FlowNoRouteEvent, {
        decisionId,
        barcode: finalOrder.barcode,
        orderNumber: finalOrder.number,
        location: this.place(location),
        source: finalOrder.sourceCoordinate,
        target: finalOrder.targetCoordinate ?? `Gruppe ${finalOrder.targetGroup}`,
      });
    }
    if (result.outcome === 'NO_ACTION' || result.outcome === 'NO_NEXT_STEP') {
      this.outbox.record(tx, FlowUnhandledEvent, {
        decisionId,
        eventType: event.type,
        barcode: event.barcode ?? null,
        location: this.place(location),
        outcome: result.outcome,
        reason: trace[trace.length - 1] ?? result.outcome,
      });
    }
    let command: FlowResult['command'] = null;
    if (result.next) {
      const barcode = ctx.unit?.barcode ?? event.barcode!;
      this.publishCommand(tx, decision, barcode, event.deviceId ?? null, finalOrder, ctx.route, location, result.next);
      command = { barcode, from: location, to: result.next };
    }
    return { decision, command, dryRun: event.dryRun };
  }

  /** Route für Quelle und Ziel des Auftrags – vom Spezifischen zum Allgemeinen. */
  private async selectRoute(ctx: Context): Promise<void> {
    const order = ctx.order!;
    const sourceLoc = order.source ? await this.lookup.resolve(ctx.tx, { id: (order.source as Location).id }) : null;
    const sources = sourceLoc ? candidates(sourceLoc.id, this.lookup.groupPathOf(sourceLoc)) : [];
    let targets: PlaceKey[];
    if (order.targetGroup) {
      targets = candidates(null, await this.lookup.groupPath(ctx.tx, order.targetGroup));
    } else if (order.target) {
      const targetLoc = await this.lookup.resolve(ctx.tx, { id: (order.target as Location).id });
      targets = candidates(targetLoc.id, this.lookup.groupPathOf(targetLoc));
    } else {
      targets = [];
    }
    const ids = [...sources, ...targets].flatMap((k) => (k.kind === 'location' ? [k.id] : []));
    const names = [...sources, ...targets].flatMap((k) => (k.kind === 'group' ? [k.name] : []));
    const rows =
      sources.length && targets.length
        ? await ctx.tx.find(
            FlowRoute,
            {
              enabled: true,
              $and: [
                { $or: [{ sourceLocation: { $in: ids } }, { sourceGroup: { $in: names } }] },
                { $or: [{ targetLocation: { $in: ids } }, { targetGroup: { $in: names } }] },
              ],
            },
            { populate: ['sourceLocation', 'targetLocation'] },
          )
        : [];
    const match = bestRoute(
      rows.map((route) => ({
        routeId: route.routeId,
        source: keyOf(route.sourceLocation as Location | null, route.sourceGroup),
        target: keyOf(route.targetLocation as Location | null, route.targetGroup),
        entity: route,
      })),
      sources,
      targets,
    );
    const describe = `von ${order.sourceCoordinate} nach ${order.targetCoordinate ?? `Gruppe ${order.targetGroup}`}`;
    if (!match) {
      ctx.trace.push(`Keine Route ${describe} (${rows.length} Kandidaten geprüft)`);
      return;
    }
    ctx.route = match.route.entity;
    ctx.trace.push(`Route ${match.route.routeId} ${describe}: Quelle ${placeLabel(match.route.source)} (Stufe ${match.sourceRank + 1}), Ziel ${placeLabel(match.route.target)} (Stufe ${match.targetRank + 1})`);
  }

  private async selectAction(ctx: Context): Promise<FlowAction | null> {
    const places = candidates(ctx.location.id, ctx.groupPath);
    const rows = await ctx.tx.find(
      FlowAction,
      {
        enabled: true,
        eventType: ctx.event.type,
        $and: [
          { $or: [{ location: ctx.location.id }, { group: { $in: ctx.groupPath } }, { location: null, group: null }] },
          { $or: [{ route: null }, ...(ctx.route ? [{ route: ctx.route.id }] : [])] },
        ],
      },
      { populate: ['route', 'location'] },
    );
    const best = bestAction(
      rows.map((a) => ({
        name: a.name,
        routeId: (a.route as FlowRoute | null)?.routeId ?? null,
        place: a.location || a.group ? keyOf(a.location as Location | null, a.group) : null,
        entity: a,
      })),
      places,
      ctx.route?.routeId ?? null,
    );
    if (!best) {
      ctx.trace.push(`Keine Action für ${ctx.event.type}${ctx.route ? ` auf Route ${ctx.route.routeId}` : ''} an ${ctx.location.locationId} (${rows.length} Kandidaten)`);
      return null;
    }
    const where = best.place ? placeLabel(best.place, { [ctx.location.id]: ctx.location.locationId }) : 'überall';
    ctx.trace.push(`Action ${best.name}: Programm ${best.entity.program} (${where}, Route ${best.routeId ?? 'beliebig'})`);
    return best.entity;
  }

  private async runProgram(ctx: Context, action: FlowAction): Promise<ProgramResult> {
    const program = action.program as ProgramKey;
    // Gespeicherte Parameter erneut prüfen: Schemaänderungen fallen hier auf, nicht erst im Programm.
    const params = PROGRAMS[program].params.parse(action.params) as never;
    switch (program) {
      case 'route-next':
        return this.routeNext(ctx);
      case 'create-order':
        return this.createOrder(ctx, params);
      case 'send-to':
        return this.sendTo(ctx, params);
      case 'book':
        await this.book(ctx);
        return { outcome: 'HANDLED' };
      case 'finish-order':
        return this.finishOrder(ctx);
      case 'lock-location':
        return this.lockLocation(ctx, params);
      case 'interrupt-order':
        return this.interruptOrder(ctx);
      case 'node-red':
        return this.delegate(ctx, action, params);
    }
  }

  // --- Programme ------------------------------------------------------------

  private async routeNext(ctx: Context): Promise<ProgramResult> {
    const order = ctx.order;
    if (!order) {
      ctx.trace.push('route-next braucht einen laufenden Transportauftrag');
      return { outcome: 'NO_NEXT_STEP' };
    }
    if (order.state !== 'STARTED') {
      ctx.trace.push(`Auftrag ${order.number} ist ${order.state}; kein Fahrbefehl`);
      return { outcome: 'NO_NEXT_STEP' };
    }
    await this.book(ctx);
    const target = order.target as Location | null;
    if (target && target.id === ctx.location.id) {
      return this.finish(ctx, 'Ziel erreicht');
    }
    const step = ctx.route ? await this.nextStep(ctx) : null;
    if (step) {
      const next = await this.lookup.resolve(ctx.tx, { id: (step.next as Location).id });
      ctx.trace.push(`Schritt ${step.pos}${step.unitType ? ` (nur ${step.unitType})` : ''}: ${ctx.location.locationId} → ${next.locationId}`);
      return { outcome: 'COMMAND', next };
    }
    if (order.targetGroup && ctx.groupPath.includes(order.targetGroup)) {
      return this.finish(ctx, `Zielgruppe ${order.targetGroup} erreicht, kein weiterer Schritt`);
    }
    ctx.trace.push(ctx.route ? `Route ${ctx.route.routeId} hat keinen Schritt ab ${ctx.location.locationId}` : `Ohne Route kein nächster Schritt ab ${ctx.location.locationId}`);
    return { outcome: 'NO_NEXT_STEP' };
  }

  private async createOrder(ctx: Context, params: ProgramParams<'create-order'>): Promise<ProgramResult> {
    const barcode = ctx.event.barcode;
    if (!barcode) throw new DomainError('invalid', 'BARCODE_REQUIRED', 'create-order braucht den Barcode der TU', {});
    if (!ctx.unit) {
      if (!params.typeCode) {
        throw new RuleViolationError('TU_TYPE_REQUIRED', `TU ${barcode} ist unbekannt und die Action nennt keinen TU-Typ`, { barcode });
      }
      const { unit } = await this.units.createIn(ctx.tx, { barcode, typeCode: params.typeCode, location: { id: ctx.location.id }, weight: null, state: 'AVAILABLE', mode: 'physical' });
      ctx.unit = await this.units.loadIn(ctx.tx, unit.barcode);
      ctx.trace.push(`TU ${barcode} (${params.typeCode}) auf ${ctx.location.locationId} angelegt`);
    }
    if (!ctx.order) {
      await this.book(ctx);
      const created = await this.orders.createIn(ctx.tx, { barcode, target: params.target, priority: params.priority, redirect: false, autoStart: true });
      // Direkt das angelegte Objekt verwenden: der Start ist noch nicht in die Datenbank geschrieben.
      ctx.order = created.state === 'STARTED' ? created : null;
      if (!ctx.order) {
        ctx.trace.push(`Transportauftrag ${created.number} angelegt, aber nicht gestartet: ${created.problemCode ?? '?'} ${created.problemMessage ?? ''}`.trim());
        return { outcome: 'NO_NEXT_STEP' };
      }
      ctx.trace.push(`Transportauftrag ${ctx.order.number} angelegt und gestartet`);
      await this.selectRoute(ctx);
    }
    return this.routeNext(ctx);
  }

  private async sendTo(ctx: Context, params: ProgramParams<'send-to'>): Promise<ProgramResult> {
    await this.book(ctx);
    const next = await this.lookup.resolve(ctx.tx, params.location);
    ctx.trace.push(`Fest konfiguriertes Ziel ${next.locationId}`);
    return { outcome: 'COMMAND', next };
  }

  private async finishOrder(ctx: Context): Promise<ProgramResult> {
    if (!ctx.order) {
      await this.book(ctx);
      ctx.trace.push('Kein laufender Auftrag zum Abschließen; TU nur gebucht');
      return { outcome: 'HANDLED' };
    }
    await this.book(ctx);
    return this.finish(ctx, 'Abschluss per Action');
  }

  private async lockLocation(ctx: Context, params: ProgramParams<'lock-location'>): Promise<ProgramResult> {
    const inbound = ctx.event.state?.inbound ?? params.inbound;
    const outbound = ctx.event.state?.outbound ?? params.outbound;
    if (inbound === undefined && outbound === undefined) {
      ctx.trace.push('Keine Sperränderung gemeldet oder konfiguriert');
      return { outcome: 'HANDLED' };
    }
    const reason = [`Anlage${ctx.event.deviceId ? ` ${ctx.event.deviceId}` : ''}`, ctx.event.code, ctx.event.message].filter(Boolean).join(': ').slice(0, 200);
    await this.locations.changeLocksIn(ctx.tx, ctx.location.id, {
      ...(inbound === undefined ? {} : { inbound }),
      ...(outbound === undefined ? {} : { outbound }),
      reason,
    });
    ctx.trace.push(`Sperren von ${ctx.location.locationId} gesetzt: ${JSON.stringify({ inbound, outbound })}`);
    return { outcome: 'HANDLED' };
  }

  private interruptOrder(ctx: Context): ProgramResult {
    if (!ctx.order || ctx.order.state !== 'STARTED') {
      ctx.trace.push('Kein gestarteter Auftrag zum Unterbrechen');
      return { outcome: 'HANDLED' };
    }
    const reason = [ctx.event.code, ctx.event.message].filter(Boolean).join(': ') || `Störung an ${ctx.location.locationId}`;
    this.orders.interruptIn(ctx.tx, ctx.order, reason.slice(0, 200));
    ctx.trace.push(`Auftrag ${ctx.order.number} unterbrochen: ${reason}`);
    return { outcome: 'HANDLED' };
  }

  private delegate(ctx: Context, action: FlowAction, params: ProgramParams<'node-red'>): ProgramResult {
    const { flow, ...rest } = params;
    this.outbox.record(ctx.tx, FlowProgramRequestedEvent, {
      decisionId: ctx.decisionId,
      flow,
      params: rest,
      eventType: ctx.event.type,
      barcode: ctx.event.barcode ?? null,
      deviceId: ctx.event.deviceId ?? null,
      location: this.place(ctx.location),
      orderNumber: ctx.order?.number ?? null,
      routeId: ctx.route?.routeId ?? null,
    });
    ctx.trace.push(`An Node-RED-Flow ${flow} übergeben (Action ${action.name})`);
    return { outcome: 'DELEGATED' };
  }

  // --- Hilfen ---------------------------------------------------------------

  /** TU auf den gemeldeten Platz buchen (physisch: die Anlage meldet eine Tatsache). */
  private async book(ctx: Context): Promise<void> {
    if (!ctx.unit) {
      throw new RuleViolationError('TU_UNKNOWN', `TU ${ctx.event.barcode ?? '(ohne Barcode)'} ist unbekannt`, { barcode: ctx.event.barcode ?? null });
    }
    const current = ctx.unit.location as Location;
    if (current.id === ctx.location.id) return;
    const { violations } = await this.units.moveIn(ctx.tx, ctx.unit.barcode, { to: { id: ctx.location.id }, mode: 'physical' });
    ctx.trace.push(`TU gebucht: ${current.locationId} → ${ctx.location.locationId}${violations.length ? ` (Verstöße: ${violations.map((v) => v.rule).join(', ')})` : ''}`);
  }

  private async finish(ctx: Context, why: string): Promise<ProgramResult> {
    const order = ctx.order!;
    await this.orders.finishIn(ctx.tx, order.number, { location: { id: ctx.location.id }, mode: 'physical' });
    ctx.trace.push(`${why}: Auftrag ${order.number} abgeschlossen`);
    return { outcome: 'FINISHED' };
  }

  private async nextStep(ctx: Context): Promise<FlowRouteStep | null> {
    const unitType = ctx.unit ? (ctx.unit.type as TransportUnitType).code : null;
    const steps = await ctx.tx.find(
      FlowRouteStep,
      { route: ctx.route!.id, from: ctx.location.id, enabled: true, $or: [{ unitType: null }, ...(unitType ? [{ unitType }] : [])] },
      { orderBy: { pos: 'asc' } },
    );
    // Schritte für den TU-Typ haben Vorrang vor allgemeinen.
    return steps.find((s) => s.unitType !== null) ?? steps[0] ?? null;
  }

  private async findUnit(tx: EntityManager, barcode: string): Promise<TransportUnit | null> {
    try {
      return await this.units.loadIn(tx, barcode);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  private place(location: Location) {
    return { id: location.id, locationId: location.locationId, plcCode: location.plcCode ?? null };
  }

  private publishCommand(
    tx: EntityManager,
    decision: FlowDecision,
    barcode: string,
    deviceId: string | null,
    order: TransportOrder | null,
    route: FlowRoute | null,
    from: Location,
    to: Location,
  ): void {
    this.outbox.record(tx, FlowCommandEvent, {
      decisionId: decision.id,
      barcode,
      deviceId,
      orderNumber: order?.number ?? null,
      routeId: route?.routeId ?? null,
      from: this.place(from),
      to: this.place(to),
    });
  }

  private saveDecision(
    tx: EntityManager,
    id: string,
    d: {
      eventType: DeviceEvent['type'];
      event: { barcode?: string | undefined; deviceId?: string | undefined };
      location: Location;
      order: TransportOrder | null;
      route: FlowRoute | null;
      action: FlowAction | null;
      program: string | null;
      outcome: FlowOutcome;
      next: Location | null;
      trace: string[];
    },
  ): FlowDecision {
    return tx.create(FlowDecision, {
      id,
      eventType: d.eventType,
      barcode: d.event.barcode ?? null,
      deviceId: d.event.deviceId ?? null,
      locationCoordinate: d.location.locationId,
      orderNumber: d.order?.number ?? null,
      routeId: d.route?.routeId ?? null,
      actionName: d.action?.name ?? null,
      program: d.program,
      outcome: d.outcome,
      nextCoordinate: d.next?.locationId ?? null,
      trace: d.trace,
    });
  }
}
