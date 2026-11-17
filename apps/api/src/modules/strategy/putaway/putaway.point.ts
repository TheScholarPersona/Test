import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { LocationGroupNameSchema } from '@wms/shared';
import { z } from 'zod';
import { RuleViolationError } from '../../../common/domain-error.js';
import { type Location, LocationLookup } from '../../layout/index.js';
import { PlacementChecker, type PreparedUnit } from '../../transport/index.js';
import type { Facts, FieldCatalog } from '../domain/conditions.js';
import type { DecisionPointDefinition, StrategyDefinition } from '../domain/types.js';
import { type PutawayCandidate, rankFirstFree, rankWeighted } from './putaway-ranking.js';

export const PUTAWAY = 'putaway';

/** Daten, mit denen Einlagerstrategien arbeiten. */
export interface PutawayContext {
  em: EntityManager;
  prepared: PreparedUnit;
  source: Location;
  /** Suchgruppe aus der Anfrage, falls angegeben. */
  requestGroup: string | null;
  /** Typ der auslösenden Lagerbewegung, falls die Entscheidung aus einer Bewegung kommt. */
  movementType: string | null;
  /** Plätze, die nicht in Frage kommen (z. B. nach gescheiterter Zuweisung). */
  exclude: ReadonlySet<string>;
}

export const PUTAWAY_FIELDS: FieldCatalog = {
  'unit.barcode': { type: 'string', description: 'Barcode der TU' },
  'unit.typeCode': { type: 'string', description: 'TU-Typ' },
  'unit.state': { type: 'string', description: 'Zustand der TU (AVAILABLE, BLOCKED, QUALITY_CHECK)' },
  'unit.weightKg': { type: 'decimal', description: 'Gewicht der TU inkl. Stapel in KG' },
  'unit.stackSize': { type: 'number', description: 'Anzahl TUs im Stapel inkl. Basis' },
  'source.locationId': { type: 'string', description: 'Koordinate des aktuellen Platzes' },
  'source.groupName': { type: 'string', description: 'Gruppe des aktuellen Platzes' },
  'source.typeCode': { type: 'string', description: 'Platztyp des aktuellen Platzes' },
  'request.group': { type: 'string', description: 'In der Anfrage genannte Suchgruppe (fehlt, wenn keine angegeben)' },
  'request.movementType': {
    type: 'string',
    description: 'Typ der auslösenden Lagerbewegung, z. B. INBOUND oder EMPTIES (fehlt bei direkter Anfrage)',
  },
};

const SearchGroup = {
  group: LocationGroupNameSchema.optional().meta({ description: 'Suchgruppe; ohne Angabe die Gruppe aus der Anfrage' }),
  includeSubgroups: z.boolean().default(true),
};
const Weight = z.number().min(0).max(10);

const FirstFreeParams = z.strictObject(SearchGroup);
const WeightedParams = z.strictObject({
  ...SearchGroup,
  weights: z
    .strictObject({ sortOrder: Weight.default(1), emptiness: Weight.default(1), privilege: Weight.default(1) })
    .default({ sortOrder: 1, emptiness: 1, privilege: 1 }),
});

/** Entscheidungspunkt „Einlagerung“: Auf welchen Platz soll diese TU? */
@Injectable()
export class PutawayDecisionPoint {
  readonly definition: DecisionPointDefinition<PutawayContext>;

  constructor(
    private readonly lookup: LocationLookup,
    private readonly checker: PlacementChecker,
  ) {
    const firstFree: StrategyDefinition<PutawayContext, z.infer<typeof FirstFreeParams>> = {
      id: 'first-free',
      description: 'Erster geeigneter Platz der Suchgruppe in Sortierreihenfolge (sortOrder, dann Koordinate)',
      paramsSchema: FirstFreeParams,
      decide: async (ctx, params) => rankFirstFree(await this.candidates(ctx, params)),
    };
    const weighted: StrategyDefinition<PutawayContext, z.infer<typeof WeightedParams>> = {
      id: 'weighted',
      description: 'Gewichtete Bewertung geeigneter Plätze nach Sortierung, Füllgrad und Vorrang des Platztyps',
      paramsSchema: WeightedParams,
      decide: async (ctx, params) => rankWeighted(await this.candidates(ctx, params), params.weights),
    };
    this.definition = {
      id: PUTAWAY,
      description: 'Einlagerung: Auswahl eines Zielplatzes für eine Transporteinheit',
      fields: PUTAWAY_FIELDS,
      strategies: [firstFree, weighted],
    };
  }

  facts(ctx: PutawayContext): Facts {
    const unit = ctx.prepared.unit!;
    return {
      'unit.barcode': unit.barcode,
      'unit.typeCode': ctx.prepared.type.code,
      'unit.state': unit.state,
      'unit.weightKg': ctx.prepared.stackWeight.amount,
      'unit.stackSize': ctx.prepared.stack.length + 1,
      'source.locationId': ctx.source.locationId,
      'source.groupName': this.lookup.groupName(ctx.source),
      'source.typeCode': this.lookup.typeCode(ctx.source),
      'request.group': ctx.requestGroup,
      'request.movementType': ctx.movementType,
    };
  }

  /** Plätze der Suchgruppe, geprüft gegen alle harten Regeln (inkl. bereits zugewiesener TUs und Vergabesperre). */
  private async candidates(ctx: PutawayContext, params: { group?: string | undefined; includeSubgroups: boolean }): Promise<PutawayCandidate[]> {
    const group = params.group ?? ctx.requestGroup;
    if (!group) {
      throw new RuleViolationError('NO_SEARCH_GROUP', 'Weder die Regel noch die Anfrage nennt eine Suchgruppe');
    }
    const locations = (await this.lookup.inGroup(ctx.em, group, params.includeSubgroups)).filter(
      (l) => l.id !== ctx.source.id && !ctx.exclude.has(l.id),
    );
    const evaluations = await this.checker.evaluate(ctx.em, ctx.prepared, ctx.source, locations, { forAllocation: true });
    return locations.map((location) => {
      const typeCode = this.lookup.typeCode(location);
      const evaluation = evaluations.get(location.id)!;
      return {
        id: location.id,
        locationId: location.locationId,
        sortOrder: location.sortOrder,
        typeCode,
        maxTransportUnits: location.maxTransportUnits,
        occupiedSlots: evaluation.occupiedSlots,
        privilegeLevel: ctx.prepared.privilegeByLocationType.get(typeCode) ?? 0,
        violations: evaluation.violations,
      };
    });
  }
}
