import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { TransportUnitRemovalPolicy } from './application/transport-unit-removal-policy.js';
import { TransportUnitTypeService } from './application/transport-unit-type.service.js';
import { TransportUnitService } from './application/transport-unit.service.js';
import { TransportUnitTypesController } from './http/transport-unit-types.controller.js';
import { TransportUnitsController } from './http/transport-units.controller.js';

/** Transporteinheiten: Typen mit Platzierungs- und Stapelregeln, TUs, Bewegungen. */
@Module({
  imports: [LayoutModule],
  providers: [TransportUnitTypeService, TransportUnitService, TransportUnitRemovalPolicy],
  controllers: [TransportUnitTypesController, TransportUnitsController],
  exports: [TransportUnitService, TransportUnitRemovalPolicy],
})
export class TransportModule {}
