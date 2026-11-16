import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import type { Quantity } from '@wms/shared';
import { type Location, LocationLookup, type LocationType } from '../../layout/index.js';
import { checkPlacement, KG, type PlacementViolation } from '../domain/placement.js';
import type { TransportUnitType } from '../entities/transport-unit-type.entity.js';
import { TransportUnit } from '../entities/transport-unit.entity.js';
import { effectiveWeight } from './mappers.js';
import { TransportUnitTypeService } from './transport-unit-type.service.js';

const MAX_STACK_DEPTH = 50;

/** Für die Prüfung vorbereitete TU (bestehend oder geplant). */
export interface PreparedUnit {
  /** `null` für eine noch nicht angelegte TU. */
  unit: TransportUnit | null;
  type: TransportUnitType;
  /** TUs, die (mittelbar) auf der TU stehen und mitbewegt werden. */
  stack: TransportUnit[];
  stackWeight: Quantity;
  /** Erlaubte Platztypen; leer = überall. */
  allowedLocationTypes: string[];
  /** Vorrang je Platztyp laut Platzierungsregel (für Strategien). */
  privilegeByLocationType: Map<string, number>;
}

/** Prüfergebnis für einen Zielplatz. */
export interface TargetEvaluation {
  violations: PlacementViolation[];
  /** Direkt belegte Stellplätze ohne die geprüfte TU (bei Platzvergabe inkl. zugewiesener TUs). */
  occupiedSlots: number;
}

export interface EvaluateOptions {
  /**
   * Platzvergabe: TUs, die einen Platz als Ziel haben, aber noch nicht dort
   * stehen, zählen als belegt; zusätzlich gilt die Vergabesperre des Platzes.
   */
  forAllocation?: boolean;
}

/**
 * Harte Platzierungsregeln für TUs. Wird vom TU-Modul (Anlegen, Bewegen)
 * und von Strategien (Platzvergabe) gleichermaßen verwendet – keine
 * Strategie kann diese Regeln umgehen.
 */
@Injectable()
export class PlacementChecker {
  constructor(
    private readonly lookup: LocationLookup,
    private readonly types: TransportUnitTypeService,
  ) {}

  async prepareExisting(em: EntityManager, unit: TransportUnit): Promise<PreparedUnit> {
    const type = unit.type as TransportUnitType;
    const stack = await this.descendants(em, unit);
    const stackWeight = [unit, ...stack].reduce((sum, u) => sum.add(effectiveWeight(u)), KG('0'));
    return { unit, type, stack, stackWeight, ...(await this.placementRules(em, type)) };
  }

  async prepareNew(em: EntityManager, type: TransportUnitType, weightKg: string | null): Promise<PreparedUnit> {
    return { unit: null, type, stack: [], stackWeight: KG(weightKg ?? type.tareWeightKg), ...(await this.placementRules(em, type)) };
  }

  /**
   * Prüft beliebig viele Zielplätze mit wenigen Abfragen.
   * Rückgabe: Verstöße je Lagerplatz-ID (leer = geeignet).
   */
  async evaluate(
    em: EntityManager,
    prepared: PreparedUnit,
    source: Location | null,
    targets: Location[],
    options: EvaluateOptions = {},
  ): Promise<Map<string, TargetEvaluation>> {
    const result = new Map<string, TargetEvaluation>();
    if (targets.length === 0) {
      return result;
    }
    const excluded = prepared.unit ? [prepared.unit.id, ...prepared.stack.map((u) => u.id)] : [];
    const withoutSelf = (where: Record<string, unknown>): FilterQuery<TransportUnit> =>
      (excluded.length > 0 ? { ...where, id: { $nin: excluded } } : where) as FilterQuery<TransportUnit>;

    // `refresh`: Belegung immer frisch aus der Datenbank lesen, nicht aus dem Identity Map –
    // wichtig, wenn nach dem Sperren eines Platzes erneut geprüft wird.
    const present = await em.find(TransportUnit, withoutSelf({ location: { $in: targets } }), { populate: ['type'], refresh: true });
    const incoming = options.forAllocation
      ? (await em.find(TransportUnit, withoutSelf({ target: { $in: targets } }), { populate: ['type', 'location'], refresh: true })).filter(
          (u) => (u.location as Location).id !== (u.target as Location).id,
        )
      : [];

    const sourceLocks = source ? this.lookup.locks(source) : null;
    for (const target of targets) {
      const here = present.filter((u) => (u.location as Location).id === target.id);
      const arriving = incoming.filter((u) => (u.target as Location).id === target.id);
      const locks = this.lookup.locks(target);
      const occupiedSlots = here.filter((u) => !u.parent).length + arriving.filter((u) => !u.parent).length;
      const violations = checkPlacement({
        unit: { typeCode: prepared.type.code, allowedLocationTypes: prepared.allowedLocationTypes, stackWeight: prepared.stackWeight },
        source:
          source && sourceLocks
            ? { locationId: source.locationId, outboundBlocked: sourceLocks.outbound.blocked, outboundBlockedBy: sourceLocks.outbound.blockedBy?.name ?? null }
            : null,
        target: {
          locationId: target.locationId,
          typeCode: this.lookup.typeCode(target),
          inboundBlocked: locks.inbound.blocked,
          inboundBlockedBy: locks.inbound.blockedBy?.name ?? null,
          maxTransportUnits: target.maxTransportUnits,
          maxWeight: target.maxWeightKg == null ? null : KG(target.maxWeightKg),
          occupiedSlots,
          currentWeight: [...here, ...arriving].reduce((sum, u) => sum.add(effectiveWeight(u)), KG('0')),
        },
      });
      if (options.forAllocation && target.allocationBlocked) {
        violations.push({ rule: 'ALLOCATION_BLOCKED', message: `Platz ${target.locationId} ist für die Platzvergabe gesperrt` });
      }
      result.set(target.id, { violations, occupiedSlots });
    }
    return result;
  }

  /** Alle TUs, die (mittelbar) auf `unit` stehen. */
  async descendants(em: EntityManager, unit: TransportUnit): Promise<TransportUnit[]> {
    const result: TransportUnit[] = [];
    let frontier = [unit];
    for (let depth = 0; frontier.length > 0 && depth < MAX_STACK_DEPTH; depth++) {
      frontier = await em.find(TransportUnit, { parent: { $in: frontier } }, { populate: ['type'] });
      result.push(...frontier);
    }
    return result;
  }

  private async placementRules(em: EntityManager, type: TransportUnitType) {
    const rules = await this.types.rulesOf(em, type);
    return {
      allowedLocationTypes: rules.placement.map((r) => (r.locationType as LocationType).code),
      privilegeByLocationType: new Map(rules.placement.map((r) => [(r.locationType as LocationType).code, r.privilegeLevel])),
    };
  }
}
