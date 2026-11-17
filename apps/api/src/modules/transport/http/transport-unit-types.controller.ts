import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { toTransportUnitTypeDto } from '../application/mappers.js';
import { TransportUnitTypeService } from '../application/transport-unit-type.service.js';
import {
  type CreateTransportUnitType,
  CreateTransportUnitTypeSchema,
  itemsOf,
  type PlacementRulesInput,
  PlacementRulesSchema,
  type StackingRulesInput,
  StackingRulesSchema,
  TransportUnitTypeCodeParam,
  type TransportUnitTypeDto,
  TransportUnitTypeDtoSchema,
  type UpdateTransportUnitType,
  UpdateTransportUnitTypeSchema,
} from './schemas.js';

const TAGS = ['Transporteinheiten: Typen'];
const PATH = '/v1/transport-unit-types';
type CodeParam = { code: string };

@Controller('v1/transport-unit-types')
export class TransportUnitTypesController {
  constructor(
    private readonly types: TransportUnitTypeService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'TU-Typ', schema: TransportUnitTypeDtoSchema };
    docs.route({ method: 'get', path: PATH, summary: 'Alle TU-Typen mit Regeln', tags: TAGS, response: { status: 200, description: 'Liste', schema: itemsOf(TransportUnitTypeDtoSchema) } });
    docs.route({ method: 'post', path: PATH, summary: 'TU-Typ anlegen', tags: TAGS, body: CreateTransportUnitTypeSchema, response: { ...one, status: 201 }, errors: [400, 409] });
    docs.route({ method: 'get', path: `${PATH}/{code}`, summary: 'TU-Typ lesen', tags: TAGS, params: TransportUnitTypeCodeParam, response: one, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{code}`, summary: 'TU-Typ ändern', tags: TAGS, params: TransportUnitTypeCodeParam, body: UpdateTransportUnitTypeSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'put', path: `${PATH}/{code}/placement-rules`, summary: 'Platzierungsregeln ersetzen (erlaubte Platztypen)', tags: TAGS, params: TransportUnitTypeCodeParam, body: PlacementRulesSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'put', path: `${PATH}/{code}/stacking-rules`, summary: 'Stapelregeln ersetzen (was auf diesen Typ gestapelt werden darf)', tags: TAGS, params: TransportUnitTypeCodeParam, body: StackingRulesSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: `${PATH}/{code}`, summary: 'TU-Typ löschen (nur wenn unbenutzt)', tags: TAGS, params: TransportUnitTypeCodeParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
  }

  @Get()
  async list(): Promise<{ items: TransportUnitTypeDto[] }> {
    return { items: (await this.types.list()).map(({ type, rules }) => toTransportUnitTypeDto(type, rules)) };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateTransportUnitTypeSchema)) body: CreateTransportUnitType): Promise<TransportUnitTypeDto> {
    const { type, rules } = await this.types.create(body);
    return toTransportUnitTypeDto(type, rules);
  }

  @Get(':code')
  async get(@Param(new ZodValidationPipe(TransportUnitTypeCodeParam)) { code }: CodeParam): Promise<TransportUnitTypeDto> {
    const { type, rules } = await this.types.get(code);
    return toTransportUnitTypeDto(type, rules);
  }

  @Patch(':code')
  async update(
    @Param(new ZodValidationPipe(TransportUnitTypeCodeParam)) { code }: CodeParam,
    @Body(new ZodValidationPipe(UpdateTransportUnitTypeSchema)) body: UpdateTransportUnitType,
  ): Promise<TransportUnitTypeDto> {
    const { type, rules } = await this.types.update(code, body);
    return toTransportUnitTypeDto(type, rules);
  }

  @Put(':code/placement-rules')
  async replacePlacementRules(
    @Param(new ZodValidationPipe(TransportUnitTypeCodeParam)) { code }: CodeParam,
    @Body(new ZodValidationPipe(PlacementRulesSchema)) body: PlacementRulesInput,
  ): Promise<TransportUnitTypeDto> {
    const { type, rules } = await this.types.replacePlacementRules(code, body);
    return toTransportUnitTypeDto(type, rules);
  }

  @Put(':code/stacking-rules')
  async replaceStackingRules(
    @Param(new ZodValidationPipe(TransportUnitTypeCodeParam)) { code }: CodeParam,
    @Body(new ZodValidationPipe(StackingRulesSchema)) body: StackingRulesInput,
  ): Promise<TransportUnitTypeDto> {
    const { type, rules } = await this.types.replaceStackingRules(code, body);
    return toTransportUnitTypeDto(type, rules);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param(new ZodValidationPipe(TransportUnitTypeCodeParam)) { code }: CodeParam): Promise<void> {
    await this.types.delete(code);
  }
}
