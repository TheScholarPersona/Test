import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { LocationGroupNameSchema, type Quantity } from '@wms/shared';
import { z } from 'zod';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { availableOf, type StockItem } from '../../inventory/index.js';
import { type Location, LocationLookup } from '../../layout/index.js';
import type { TransportUnit } from '../../transport/index.js';
import type { Facts, FieldCatalog } from '../domain/conditions.js';
import type { DecisionPointDefinition, StrategyDefinition } from '../domain/types.js';
import { type AllocationCandidate, type AllocationEvaluation, type AllocationStrategyId, rankAllocation, shelfLifeViolation } from './allocation-ranking.js';

export const ALLOCATION = 'allocation';

/** Daten, mit denen Auslagerstrategien arbeiten (Bestand frisch gelesen, TUs gesperrt). */
export interface AllocationContext {
  em: EntityManager;
  sku: string;
  demand: Quantity;
  lot: string | null;
  orderPriority: string | null;
  customer: string | null;
  /** Heutiges Datum (JJJJ-MM-TT) für die Mindestrestlaufzeit. */
  today: string;
  items: StockItem[];
  countedUnits: Set<string>;
  itemsPerUnit: Map<string, number>;
}

export const ALLOCATION_FIELDS: FieldCatalog = {
  'product.sku': { type: 'string', description: 'Artikelnummer' },
  'demand.amount': { type: 'decimal', description: 'Bedarf in der Basiseinheit' },
  'demand.unit': { type: 'string', description: 'Basiseinheit des Produkts' },
  'demand.lot': { type: 'string', description: 'Geforderte Charge (fehlt, wenn keine gefordert ist)' },
  'order.priority': { type: 'string', description: 'Priorität des Auslagerauftrags (fehlt bei Simulation ohne Auftrag)' },
  'order.customer': { type: 'string', description: 'Kunde des Auslagerauftrags' },
};

const Params = z.strictObject({
  group: LocationGroupNameSchema.optional().meta({ description: 'Nur Bestand in dieser Gruppe; ohne Angabe im ganzen Lager' }),
  includeSubgroups: z.boolean().default(true),
  minRemainingDays: z.number().int().min(0).max(3650).default(0).meta({ description: 'Mindestrestlaufzeit in Tagen (harte Regel)' }),
});
type AllocationParams = z.infer<typeof Params>;

const DESCRIPTIONS: Record<AllocationStrategyId, string> = {
  fifo: 'FIFO: ältester Zugang zuerst',
  fefo: 'FEFO: frühestes Mindesthaltbarkeitsdatum zuerst (ohne MHD zuletzt)',
  lifo: 'LIFO: jüngster Zugang zuerst',
  'partial-first': 'Anbruch zuerst: kleinste Restmengen zuerst, um Anbrüche zu räumen',
  'full-unit': 'Ganze TU bevorzugen: möglichst ganze Posten, Rest vom kleinsten deckenden Posten',
};

/**
 * Entscheidungspunkt „Auslagerung“: Welcher Bestand wird für einen Bedarf
 * (Produkt + Menge) genommen? Harte Regeln, die keine Strategie aufheben kann:
 * verfügbare Menge > 0, TU freigegeben (AVAILABLE), Platz nicht für die
 * Auslagerung gesperrt, keine laufende Inventur, ggf. geforderte Charge und
 * Mindestrestlaufzeit.
 */
@Injectable()
export class AllocationDecisionPoint {
  readonly definition: DecisionPointDefinition<AllocationContext>;

  constructor(private readonly lookup: LocationLookup) {
    const strategies = (Object.keys(DESCRIPTIONS) as AllocationStrategyId[]).map(
      (id): StrategyDefinition<AllocationContext, AllocationParams> => ({
        id,
        description: DESCRIPTIONS[id],
        paramsSchema: Params,
        decide: async (ctx, params) => rankAllocation(await this.candidates(ctx, params), id, ctx.demand),
      }),
    );
    this.definition = {
      id: ALLOCATION,
      description: 'Auslagerung: Auswahl der Bestandsposten für einen Bedarf',
      fields: ALLOCATION_FIELDS,
      strategies,
    };
  }

  facts(ctx: AllocationContext): Facts {
    return {
      'product.sku': ctx.sku,
      'demand.amount': ctx.demand.amount,
      'demand.unit': ctx.demand.unit,
      'demand.lot': ctx.lot,
      'order.priority': ctx.orderPriority,
      'order.customer': ctx.customer,
    };
  }

  /** Bewertet die Bestandsposten gegen die harten Regeln. */
  private async candidates(ctx: AllocationContext, params: AllocationParams): Promise<AllocationCandidate[]> {
    await this.lookup.loadHierarchy(ctx.em);
    const inGroup = params.group ? new Set((await this.lookup.inGroup(ctx.em, params.group, params.includeSubgroups)).map((l) => l.id)) : null;
    const result: AllocationCandidate[] = [];
    for (const item of ctx.items) {
      const unit = item.unit as TransportUnit;
      const location = unit.location as Location;
      if (inGroup && !inGroup.has(location.id)) continue;
      const available = availableOf(item);
      const violations: { rule: string; message: string }[] = [];
      if (available.isZero() || available.isNegative()) {
        violations.push({ rule: 'NOT_AVAILABLE', message: `Nichts verfügbar (Bestand ${normalizeDecimal(item.quantity)}, reserviert ${normalizeDecimal(item.reserved)})` });
      }
      if (unit.state !== 'AVAILABLE') violations.push({ rule: 'UNIT_NOT_AVAILABLE', message: `TU ${unit.barcode} ist ${unit.state}` });
      const lock = this.lookup.locks(location).outbound;
      if (lock.blocked) {
        violations.push({ rule: 'SOURCE_OUTBOUND_BLOCKED', message: `Platz ${location.locationId} ist für Auslagerung gesperrt (durch ${lock.blockedBy?.name})` });
      }
      if (ctx.countedUnits.has(unit.id)) violations.push({ rule: 'COUNT_IN_PROGRESS', message: `Auf TU ${unit.barcode} läuft eine Inventur` });
      const bestBefore = item.bestBefore ? String(item.bestBefore).slice(0, 10) : null;
      const shelf = shelfLifeViolation(bestBefore, ctx.today, params.minRemainingDays);
      if (shelf) violations.push(shelf);
      result.push({
        id: item.id,
        barcode: unit.barcode,
        locationId: location.locationId,
        available: available.isNegative() ? '0' : available.amount,
        unit: item.unitCode,
        lot: item.lot ?? null,
        bestBefore,
        receivedAt: item.createdAt.toISOString(),
        wholeUnit: (ctx.itemsPerUnit.get(unit.id) ?? 0) === 1 && normalizeDecimal(item.reserved) === '0',
        violations,
      });
    }
    return result;
  }
}

export type { AllocationEvaluation };
