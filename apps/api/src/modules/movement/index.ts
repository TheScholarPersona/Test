/**
 * Öffentliche Schnittstelle des Moduls Lagerbewegungen.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Movement } from './entities/movement.entity.js';

export { MovementModule } from './movement.module.js';
export { MovementService } from './application/movement.service.js';
export type { CreateMovement } from './http/schemas.js';
export { Movement };

export const movementEntities = [Movement];
