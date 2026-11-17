/**
 * Öffentliche Schnittstelle des Moduls Lagerstruktur.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { LocationGroup } from './entities/location-group.entity.js';
import { LocationType } from './entities/location-type.entity.js';
import { Location } from './entities/location.entity.js';

export { LayoutModule } from './layout.module.js';
export { LocationService } from './application/location.service.js';
export { LocationGroupService } from './application/location-group.service.js';
export { LocationRemovalPolicy, type LocationRemovalCheck, type LocationRef } from './application/location-removal-policy.js';
export {
  LocationLookup,
  LocationReferenceSchema,
  type LocationLocks,
  type LocationReference,
} from './application/location-lookup.js';
export type { EffectiveLock } from './domain/lock-state.js';
export type { ChangeLocationLocks } from './http/schemas.js';
export { Location, LocationGroup, LocationType };

export const layoutEntities = [LocationType, LocationGroup, Location];
