import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/domain-error.js';
import type { DecisionPointDefinition } from '../domain/types.js';
import { AllocationDecisionPoint } from '../allocation/allocation.point.js';
import { PutawayDecisionPoint } from '../putaway/putaway.point.js';

/**
 * Alle Entscheidungspunkte mit ihren Strategien. Neue Entscheidungspunkte
 * (Auslagerung, Routing, …) werden hier eingetragen.
 */
@Injectable()
export class StrategyRegistry {
  private readonly points = new Map<string, DecisionPointDefinition<any>>();

  constructor(putaway: PutawayDecisionPoint, allocation: AllocationDecisionPoint) {
    this.points.set(putaway.definition.id, putaway.definition);
    this.points.set(allocation.definition.id, allocation.definition);
  }

  all(): DecisionPointDefinition<any>[] {
    return [...this.points.values()];
  }

  get(id: string): DecisionPointDefinition<any> {
    const point = this.points.get(id);
    if (!point) {
      throw new NotFoundError('DECISION_POINT_NOT_FOUND', `Entscheidungspunkt [${id}] existiert nicht`, {
        id,
        available: [...this.points.keys()],
      });
    }
    return point;
  }
}
