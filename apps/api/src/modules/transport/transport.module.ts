import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { PlacementChecker } from './application/placement-checker.js';
import { TransportUnitClaims } from './application/transport-unit-claims.js';
import { TransportUnitRemovalPolicy } from './application/transport-unit-removal-policy.js';
import { TransportUnitTypeService } from './application/transport-unit-type.service.js';
import { TransportUnitService } from './application/transport-unit.service.js';
import { UnitErrorService } from './application/unit-error.service.js';
import { TransportUnitTypesController } from './http/transport-unit-types.controller.js';
import { TransportUnitsController } from './http/transport-units.controller.js';
import { UnitErrorsController } from './http/unit-errors.controller.js';

/** Transporteinheiten: Typen mit Platzierungs- und Stapelregeln, TUs, Bewegungen. */
@Module({
  imports: [LayoutModule],
  providers: [TransportUnitTypeService, TransportUnitService, TransportUnitRemovalPolicy, TransportUnitClaims, PlacementChecker, UnitErrorService],
  controllers: [TransportUnitTypesController, TransportUnitsController, UnitErrorsController],
  exports: [TransportUnitService, TransportUnitRemovalPolicy, TransportUnitClaims, PlacementChecker, UnitErrorService],
})
export class TransportModule {}
