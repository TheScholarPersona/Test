/**
 * Öffentliche Schnittstelle des Partnermoduls.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Partner } from './entities/partner.entity.js';

export { PartnerModule } from './partner.module.js';
export { addressOf, PartnerService } from './application/partner.service.js';
export { AddressInputSchema, type AddressInput, PartnerCodeSchema } from './http/schemas.js';
export { Partner };

export const partnerEntities = [Partner];
