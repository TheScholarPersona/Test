import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { LocationTypeService } from '../application/location-type.service.js';
import { toLocationTypeDto } from '../application/mappers.js';
import {
  type CreateLocationType,
  CreateLocationTypeSchema,
  itemsOf,
  LocationTypeCodeParam,
  type LocationTypeDto,
  LocationTypeDtoSchema,
  type UpdateLocationType,
  UpdateLocationTypeSchema,
} from './schemas.js';

const TAGS = ['Lagerstruktur: Platztypen'];
const PATH = '/v1/location-types';

@Controller('v1/location-types')
export class LocationTypesController {
  constructor(
    private readonly types: LocationTypeService,
    docs: ApiDocumentation,
  ) {
    docs.route({ method: 'get', path: PATH, summary: 'Alle Lagerplatztypen', tags: TAGS, response: { status: 200, description: 'Liste', schema: itemsOf(LocationTypeDtoSchema) } });
    docs.route({ method: 'post', path: PATH, summary: 'Lagerplatztyp anlegen', tags: TAGS, body: CreateLocationTypeSchema, response: { status: 201, description: 'Angelegt', schema: LocationTypeDtoSchema }, errors: [400, 409] });
    docs.route({ method: 'get', path: `${PATH}/{code}`, summary: 'Lagerplatztyp lesen', tags: TAGS, params: LocationTypeCodeParam, response: { status: 200, description: 'Gefunden', schema: LocationTypeDtoSchema }, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{code}`, summary: 'Lagerplatztyp ändern', tags: TAGS, params: LocationTypeCodeParam, body: UpdateLocationTypeSchema, response: { status: 200, description: 'Geändert', schema: LocationTypeDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: `${PATH}/{code}`, summary: 'Lagerplatztyp löschen (nur wenn unbenutzt)', tags: TAGS, params: LocationTypeCodeParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
  }

  @Get()
  async list(): Promise<{ items: LocationTypeDto[] }> {
    return { items: (await this.types.list()).map(toLocationTypeDto) };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateLocationTypeSchema)) body: CreateLocationType): Promise<LocationTypeDto> {
    return toLocationTypeDto(await this.types.create(body));
  }

  @Get(':code')
  async get(@Param(new ZodValidationPipe(LocationTypeCodeParam)) { code }: { code: string }): Promise<LocationTypeDto> {
    return toLocationTypeDto(await this.types.get(code));
  }

  @Patch(':code')
  async update(
    @Param(new ZodValidationPipe(LocationTypeCodeParam)) { code }: { code: string },
    @Body(new ZodValidationPipe(UpdateLocationTypeSchema)) body: UpdateLocationType,
  ): Promise<LocationTypeDto> {
    return toLocationTypeDto(await this.types.update(code, body));
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param(new ZodValidationPipe(LocationTypeCodeParam)) { code }: { code: string }): Promise<void> {
    await this.types.delete(code);
  }
}
