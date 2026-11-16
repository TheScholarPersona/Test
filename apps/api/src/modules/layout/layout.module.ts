import { Module } from '@nestjs/common';
import { LocationGroupService } from './application/location-group.service.js';
import { LocationRemovalPolicy } from './application/location-removal-policy.js';
import { LocationTypeService } from './application/location-type.service.js';
import { LocationService } from './application/location.service.js';
import { LocationGroupsController } from './http/location-groups.controller.js';
import { LocationTypesController } from './http/location-types.controller.js';
import { LocationsController } from './http/locations.controller.js';

/** Lagerstruktur: Platztypen, Gruppen (Hierarchie, Sperren) und Lagerplätze. */
@Module({
  providers: [LocationTypeService, LocationGroupService, LocationService, LocationRemovalPolicy],
  controllers: [LocationTypesController, LocationGroupsController, LocationsController],
  exports: [LocationService, LocationRemovalPolicy],
})
export class LayoutModule {}
