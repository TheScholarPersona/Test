import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { toTransportUnitDto } from '../application/mappers.js';
import { type PlacementOutcome, TransportUnitService } from '../application/transport-unit.service.js';
import {
  BarcodeParam,
  type ChangeState,
  ChangeStateSchema,
  type CreateTransportUnit,
  CreateTransportUnitSchema,
  type MoveTransportUnit,
  MoveTransportUnitSchema,
  pageOf,
  type PlacementResult,
  PlacementResultSchema,
  type StackInput,
  StackSchema,
  type TransportUnitDto,
  TransportUnitDtoSchema,
  type TransportUnitQuery,
  TransportUnitQuerySchema,
  type UnstackInput,
  UnstackSchema,
  type UpdateTransportUnit,
  UpdateTransportUnitSchema,
} from './schemas.js';

const TAGS = ['Transporteinheiten'];
const PATH = '/v1/transport-units';
type BarcodeParams = { barcode: string };

const toResult = ({ unit, violations }: PlacementOutcome): PlacementResult => ({ unit: toTransportUnitDto(unit), violations });

@Controller('v1/transport-units')
export class TransportUnitsController {
  constructor(
    private readonly units: TransportUnitService,
    docs: ApiDocumentation,
  ) {
    const unit = { status: 200, description: 'Transporteinheit', schema: TransportUnitDtoSchema };
    const placed = { status: 200, description: 'Ergebnis mit festgestellten Regelverstößen (nur im Modus physical möglich)', schema: PlacementResultSchema };
    const p = BarcodeParam;
    docs.route({ method: 'get', path: PATH, summary: 'Transporteinheiten suchen', tags: TAGS, query: TransportUnitQuerySchema, response: { status: 200, description: 'Treffer', schema: pageOf(TransportUnitDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Transporteinheit auf einem Lagerplatz anlegen', tags: TAGS, body: CreateTransportUnitSchema, response: { ...placed, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{barcode}`, summary: 'Transporteinheit lesen', tags: TAGS, params: p, response: unit, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{barcode}`, summary: 'Gewicht oder geplantes Ziel ändern', tags: TAGS, params: p, body: UpdateTransportUnitSchema, response: unit, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{barcode}/move`, summary: 'Transporteinheit (samt Stapel) auf einen anderen Platz bewegen', tags: TAGS, params: p, body: MoveTransportUnitSchema, response: placed, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{barcode}/state`, summary: 'Zustand ändern (AVAILABLE, BLOCKED, QUALITY_CHECK)', tags: TAGS, params: p, body: ChangeStateSchema, response: unit, errors: [400, 404] });
    docs.route({ method: 'post', path: `${PATH}/{barcode}/stack`, summary: 'Auf eine andere TU stapeln', tags: TAGS, params: p, body: StackSchema, response: unit, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{barcode}/unstack`, summary: 'Vom Stapel nehmen', tags: TAGS, params: p, body: UnstackSchema, response: placed, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: `${PATH}/{barcode}`, summary: 'Transporteinheit löschen', tags: TAGS, params: p, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(TransportUnitQuerySchema)) query: TransportUnitQuery): Promise<{ items: TransportUnitDto[]; total: number }> {
    const { items, total } = await this.units.list(query);
    return { items: items.map(toTransportUnitDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateTransportUnitSchema)) body: CreateTransportUnit): Promise<PlacementResult> {
    return toResult(await this.units.create(body));
  }

  @Get(':barcode')
  async get(@Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams): Promise<TransportUnitDto> {
    return toTransportUnitDto(await this.units.get(barcode));
  }

  @Patch(':barcode')
  async update(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams,
    @Body(new ZodValidationPipe(UpdateTransportUnitSchema)) body: UpdateTransportUnit,
  ): Promise<TransportUnitDto> {
    return toTransportUnitDto(await this.units.update(barcode, body));
  }

  @Post(':barcode/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams,
    @Body(new ZodValidationPipe(MoveTransportUnitSchema)) body: MoveTransportUnit,
  ): Promise<PlacementResult> {
    return toResult(await this.units.move(barcode, body));
  }

  @Post(':barcode/state')
  @HttpCode(HttpStatus.OK)
  async changeState(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams,
    @Body(new ZodValidationPipe(ChangeStateSchema)) body: ChangeState,
  ): Promise<TransportUnitDto> {
    return toTransportUnitDto(await this.units.changeState(barcode, body));
  }

  @Post(':barcode/stack')
  @HttpCode(HttpStatus.OK)
  async stack(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams,
    @Body(new ZodValidationPipe(StackSchema)) body: StackInput,
  ): Promise<TransportUnitDto> {
    return toTransportUnitDto(await this.units.stack(barcode, body));
  }

  @Post(':barcode/unstack')
  @HttpCode(HttpStatus.OK)
  async unstack(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams,
    @Body(new ZodValidationPipe(UnstackSchema)) body: UnstackInput,
  ): Promise<PlacementResult> {
    return toResult(await this.units.unstack(barcode, body));
  }

  @Delete(':barcode')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param(new ZodValidationPipe(BarcodeParam)) { barcode }: BarcodeParams): Promise<void> {
    await this.units.delete(barcode);
  }
}
