/**
 * Öffentliche Schnittstelle des Moduls Lagerstruktur.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { LocationGroup } from './entities/location-group.entity.js';
import { LocationType } from './entities/location-type.entity.js';
import { Location } from './entities/location.entity.js';

export { LayoutModule } from './layout.module.js';
export { LocationService } from './application/location.service.js';
export { LocationRemovalPolicy, type LocationRemovalCheck, type LocationRef } from './application/location-removal-policy.js';
export { Location, LocationGroup, LocationType };

export const layoutEntities = [LocationType, LocationGroup, Location];
