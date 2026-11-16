/**
 * Öffentliche Schnittstelle des Moduls Transportaufträge.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { TransportOrder } from './entities/transport-order.entity.js';

export { TransportOrderModule } from './transport-order.module.js';
export { TransportOrderService, type StartProblem } from './application/transport-order.service.js';
export type { CreateTransportOrder } from './http/schemas.js';
export { TransportOrder };

export const transportOrderEntities = [TransportOrder];
