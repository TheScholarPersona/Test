/**
 * Öffentliche Schnittstelle des Versandmoduls.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Shipment, ShipmentUnit } from './entities/shipment.entities.js';

export { ShippingModule } from './shipping.module.js';
export { ShipmentService, type LoadedShipment } from './application/shipment.service.js';
export { Shipment, ShipmentUnit };

export const shippingEntities = [Shipment, ShipmentUnit];
