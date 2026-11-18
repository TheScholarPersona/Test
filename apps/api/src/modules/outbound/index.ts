/**
 * Öffentliche Schnittstelle des Moduls Auslagerung.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { OutboundLine, OutboundOrder, OutboundPick } from './entities/outbound.entities.js';

export { OutboundModule } from './outbound.module.js';
export { OutboundService } from './application/outbound.service.js';
export { CreateOutboundOrderSchema } from './http/schemas.js';
export { OutboundOrder };

export const outboundEntities = [OutboundOrder, OutboundLine, OutboundPick];
