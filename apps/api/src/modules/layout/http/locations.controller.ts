import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { requestContext } from '../../../common/request-context.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { LocationService } from '../application/location.service.js';
import { toLocationDto } from '../application/mappers.js';
import {
  type ChangeLocationLocks,
  ChangeLocationLocksSchema,
  type ChangePlcState,
  ChangePlcStateSchema,
  type CreateLocation,
  CreateLocationSchema,
  type LocationDto,
  LocationDtoSchema,
  LocationIdParam,
  type LocationQuery,
  LocationQuerySchema,
  pageOf,
  type UpdateLocation,
  UpdateLocationSchema,
} from './schemas.js';

const TAGS = ['Lagerstruktur: Lagerplätze'];
const PATH = '/v1/locations';

@Controller('v1/locations')
export class LocationsController {
  constructor(
    private readonly locations: LocationService,
    docs: ApiDocumentation,
  ) {
    docs.route({ method: 'get', path: PATH, summary: 'Lagerplätze suchen (nach Koordinate, ERP-/SPS-Code oder Gruppe)', tags: TAGS, query: LocationQuerySchema, response: { status: 200, description: 'Treffer', schema: pageOf(LocationDtoSchema) }, errors: [400, 404] });
    docs.route({ method: 'post', path: PATH, summary: 'Lagerplatz anlegen', tags: TAGS, body: CreateLocationSchema, response: { status: 201, description: 'Angelegt', schema: LocationDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{id}`, summary: 'Lagerplatz lesen', tags: TAGS, params: LocationIdParam, response: { status: 200, description: 'Gefunden', schema: LocationDtoSchema }, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{id}`, summary: 'Lagerplatz ändern (Koordinate und Typ unveränderlich)', tags: TAGS, params: LocationIdParam, body: UpdateLocationSchema, response: { status: 200, description: 'Geändert', schema: LocationDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'patch', path: `${PATH}/{id}/locks`, summary: 'Ein-, Auslager- oder Vergabesperre setzen/aufheben', tags: TAGS, params: LocationIdParam, body: ChangeLocationLocksSchema, response: { status: 200, description: 'Sperren geändert', schema: LocationDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'patch', path: `${PATH}/{id}/plc-state`, summary: 'Zustand laut Anlage setzen (0 = in Ordnung, sonst Störungscode)', tags: TAGS, params: LocationIdParam, body: ChangePlcStateSchema, response: { status: 200, description: 'Zustand geändert', schema: LocationDtoSchema }, errors: [400, 404] });
    docs.route({ method: 'delete', path: `${PATH}/{id}`, summary: 'Lagerplatz löschen (nur ohne Einwände anderer Module)', tags: TAGS, params: LocationIdParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(LocationQuerySchema)) query: LocationQuery): Promise<{ items: LocationDto[]; total: number }> {
    const { items, total } = await this.locations.list(query);
    return { items: items.map(toLocationDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateLocationSchema)) body: CreateLocation): Promise<LocationDto> {
    return toLocationDto(await this.locations.create(body));
  }

  @Get(':id')
  async get(@Param(new ZodValidationPipe(LocationIdParam)) { id }: { id: string }): Promise<LocationDto> {
    return toLocationDto(await this.locations.get(id));
  }

  @Patch(':id')
  async update(
    @Param(new ZodValidationPipe(LocationIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(UpdateLocationSchema)) body: UpdateLocation,
  ): Promise<LocationDto> {
    return toLocationDto(await this.locations.update(id, body));
  }

  @Patch(':id/locks')
  async changeLocks(
    @Param(new ZodValidationPipe(LocationIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(ChangeLocationLocksSchema)) body: ChangeLocationLocks,
  ): Promise<LocationDto> {
    return toLocationDto(await this.locations.changeLocks(id, body));
  }

  @Patch(':id/plc-state')
  async changePlcState(
    @Param(new ZodValidationPipe(LocationIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(ChangePlcStateSchema)) body: ChangePlcState,
  ): Promise<LocationDto> {
    return toLocationDto(await this.locations.changePlcState(id, body, requestContext.get()?.actor ?? null));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param(new ZodValidationPipe(LocationIdParam)) { id }: { id: string }): Promise<void> {
    await this.locations.delete(id);
  }
}
