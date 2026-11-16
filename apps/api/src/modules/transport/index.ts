/**
 * Öffentliche Schnittstelle des Moduls Transporteinheiten.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { TransportUnitPlacementRule, TransportUnitStackingRule, TransportUnitType } from './entities/transport-unit-type.entity.js';
import { TransportUnit } from './entities/transport-unit.entity.js';

export { TransportModule } from './transport.module.js';
export { TransportUnitService } from './application/transport-unit.service.js';
export {
  TransportUnitRemovalPolicy,
  type TransportUnitRemovalCheck,
  type TransportUnitRef,
} from './application/transport-unit-removal-policy.js';
export type { PlacementViolation } from './domain/placement.js';
export { TransportUnit, TransportUnitType };

export const transportEntities = [TransportUnitType, TransportUnitPlacementRule, TransportUnitStackingRule, TransportUnit];
