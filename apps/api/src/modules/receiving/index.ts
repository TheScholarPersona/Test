/**
 * Öffentliche Schnittstelle des Wareneingangs.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { ReceivingCapture, ReceivingOrder, ReceivingPosition } from './entities/receiving.entities.js';

export { ReceivingModule } from './receiving.module.js';
export { ReceivingService } from './application/receiving.service.js';
export { CreateReceivingOrderSchema } from './http/schemas.js';

export const receivingEntities = [ReceivingOrder, ReceivingPosition, ReceivingCapture];
