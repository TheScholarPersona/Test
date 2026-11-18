import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { addressOf, PartnerService, rolesOf } from '../application/partner.service.js';
import type { Partner } from '../entities/partner.entity.js';
import {
  type ChangePartner,
  ChangePartnerSchema,
  type CreatePartner,
  CreatePartnerSchema,
  pageOf,
  type PartnerDto,
  PartnerDtoSchema,
  PartnerParam,
  type PartnerQuery,
  PartnerQuerySchema,
} from './schemas.js';

const TAGS = ['Geschäftspartner'];
const PATH = '/v1/partners';

export function toPartnerDto(partner: Partner): PartnerDto {
  return {
    code: partner.code,
    name: partner.name,
    roles: rolesOf(partner),
    address: addressOf(partner),
    email: partner.email ?? null,
    phone: partner.phone ?? null,
    active: partner.active,
    createdAt: partner.createdAt.toISOString(),
    updatedAt: partner.updatedAt.toISOString(),
  };
}

/** Geschäftspartner: Kunden, Lieferanten und Spediteure. */
@Controller('v1/partners')
export class PartnersController {
  constructor(
    private readonly partners: PartnerService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Geschäftspartner', schema: PartnerDtoSchema };
    docs.route({ method: 'get', path: PATH, summary: 'Geschäftspartner nach Nummer (Filter: Rolle, aktiv, Suche)', tags: TAGS, query: PartnerQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(PartnerDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Geschäftspartner anlegen', tags: TAGS, body: CreatePartnerSchema, response: { ...one, status: 201 }, errors: [400, 409] });
    docs.route({ method: 'get', path: `${PATH}/{code}`, summary: 'Geschäftspartner lesen', tags: TAGS, params: PartnerParam, response: one, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{code}`, summary: 'Stammdaten ändern oder deaktivieren', tags: TAGS, params: PartnerParam, body: ChangePartnerSchema, response: one, errors: [400, 404] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(PartnerQuerySchema)) query: PartnerQuery): Promise<{ items: PartnerDto[]; total: number }> {
    const { items, total } = await this.partners.list(query);
    return { items: items.map(toPartnerDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreatePartnerSchema)) body: CreatePartner): Promise<PartnerDto> {
    return toPartnerDto(await this.partners.create(body));
  }

  @Get(':code')
  async get(@Param(new ZodValidationPipe(PartnerParam)) { code }: { code: string }): Promise<PartnerDto> {
    return toPartnerDto(await this.partners.get(code));
  }

  @Patch(':code')
  async change(@Param(new ZodValidationPipe(PartnerParam)) { code }: { code: string }, @Body(new ZodValidationPipe(ChangePartnerSchema)) body: ChangePartner): Promise<PartnerDto> {
    return toPartnerDto(await this.partners.change(code, body));
  }
}
