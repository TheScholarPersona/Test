import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { LocationGroupService } from '../application/location-group.service.js';
import { toLocationGroupDto } from '../application/mappers.js';
import {
  type ChangeGroupLocks,
  ChangeGroupLocksSchema,
  type CreateLocationGroup,
  CreateLocationGroupSchema,
  itemsOf,
  type LocationGroupDto,
  LocationGroupDtoSchema,
  LocationGroupNameParam,
  type UpdateLocationGroup,
  UpdateLocationGroupSchema,
} from './schemas.js';

const TAGS = ['Lagerstruktur: Gruppen'];
const PATH = '/v1/location-groups';

@Controller('v1/location-groups')
export class LocationGroupsController {
  constructor(
    private readonly groups: LocationGroupService,
    docs: ApiDocumentation,
  ) {
    docs.route({ method: 'get', path: PATH, summary: 'Alle Lagerplatzgruppen mit wirksamen Sperren', tags: TAGS, response: { status: 200, description: 'Liste', schema: itemsOf(LocationGroupDtoSchema) } });
    docs.route({ method: 'post', path: PATH, summary: 'Lagerplatzgruppe anlegen', tags: TAGS, body: CreateLocationGroupSchema, response: { status: 201, description: 'Angelegt', schema: LocationGroupDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{name}`, summary: 'Lagerplatzgruppe lesen', tags: TAGS, params: LocationGroupNameParam, response: { status: 200, description: 'Gefunden', schema: LocationGroupDtoSchema }, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{name}`, summary: 'Beschreibung oder Gruppentyp ändern', tags: TAGS, params: LocationGroupNameParam, body: UpdateLocationGroupSchema, response: { status: 200, description: 'Geändert', schema: LocationGroupDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'patch', path: `${PATH}/{name}/locks`, summary: 'Ein- oder Auslagersperre setzen/aufheben (wirkt auf alle Untergruppen und Plätze)', tags: TAGS, params: LocationGroupNameParam, body: ChangeGroupLocksSchema, response: { status: 200, description: 'Sperren geändert', schema: LocationGroupDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: `${PATH}/{name}`, summary: 'Leere Lagerplatzgruppe löschen', tags: TAGS, params: LocationGroupNameParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
  }

  @Get()
  async list(): Promise<{ items: LocationGroupDto[] }> {
    return { items: (await this.groups.list()).map(toLocationGroupDto) };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateLocationGroupSchema)) body: CreateLocationGroup): Promise<LocationGroupDto> {
    return toLocationGroupDto(await this.groups.create(body));
  }

  @Get(':name')
  async get(@Param(new ZodValidationPipe(LocationGroupNameParam)) { name }: { name: string }): Promise<LocationGroupDto> {
    return toLocationGroupDto(await this.groups.get(name));
  }

  @Patch(':name')
  async update(
    @Param(new ZodValidationPipe(LocationGroupNameParam)) { name }: { name: string },
    @Body(new ZodValidationPipe(UpdateLocationGroupSchema)) body: UpdateLocationGroup,
  ): Promise<LocationGroupDto> {
    return toLocationGroupDto(await this.groups.update(name, body));
  }

  @Patch(':name/locks')
  async changeLocks(
    @Param(new ZodValidationPipe(LocationGroupNameParam)) { name }: { name: string },
    @Body(new ZodValidationPipe(ChangeGroupLocksSchema)) body: ChangeGroupLocks,
  ): Promise<LocationGroupDto> {
    return toLocationGroupDto(await this.groups.changeLocks(name, body));
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param(new ZodValidationPipe(LocationGroupNameParam)) { name }: { name: string }): Promise<void> {
    await this.groups.delete(name);
  }
}
