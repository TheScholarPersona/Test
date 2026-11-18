import { Module } from '@nestjs/common';
import { PartnerService } from './application/partner.service.js';
import { PartnersController } from './http/partners.controller.js';

/** Geschäftspartner-Stammdaten (Kunden, Lieferanten, Spediteure). */
@Module({
  providers: [PartnerService],
  controllers: [PartnersController],
  exports: [PartnerService],
})
export class PartnerModule {}
