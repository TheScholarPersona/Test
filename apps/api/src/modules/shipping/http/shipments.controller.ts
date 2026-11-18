import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { type LoadedShipment, ShipmentService } from '../application/shipment.service.js';
import {
  type AddShipmentUnit,
  AddShipmentUnitSchema,
  type CancelShipment,
  CancelShipmentSchema,
  type CreateShipment,
  CreateShipmentSchema,
  type LoadShipmentUnit,
  LoadShipmentUnitSchema,
  pageOf,
  type ShipmentDto,
  ShipmentDtoSchema,
  ShipmentParam,
  type ShipmentQuery,
  ShipmentQuerySchema,
  ShipmentUnitParam,
  type ShipShipment,
  ShipShipmentSchema,
} from './schemas.js';

const TAGS = ['Versand'];
const PATH = '/v1/shipments';

export function toShipmentDto({ shipment: s, units }: LoadedShipment): ShipmentDto {
  const shipTo = { name: s.shipToName ?? null, street: s.shipToStreet ?? null, postalCode: s.shipToPostalCode ?? null, city: s.shipToCity ?? null, country: s.shipToCountry ?? null };
  return {
    number: s.number,
    orderId: s.orderId,
    customerCode: s.customerCode ?? null,
    shipTo: Object.values(shipTo).some((v) => v !== null) ? shipTo : null,
    carrierCode: s.carrierCode ?? null,
    state: s.state,
    units: units.map((u) => ({ barcode: u.barcode, loaded: u.loaded, loadedAt: u.loadedAt?.toISOString() ?? null, loadedBy: u.loadedBy ?? null, contents: u.contents ?? null })),
    counts: { units: units.length, loaded: units.filter((u) => u.loaded).length },
    cancelReason: s.cancelReason ?? null,
    createdBy: s.createdBy ?? null,
    createdAt: s.createdAt.toISOString(),
    loadedAt: s.loadedAt?.toISOString() ?? null,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    shippedBy: s.shippedBy ?? null,
  };
}

type NumberParam = { number: string };

/** Versand: Sendungen bilden, verladen (Ladekontrolle) und ausliefern (Warenausgang). */
@Controller('v1/shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Sendung', schema: ShipmentDtoSchema };
    const p = ShipmentParam;
    docs.route({ method: 'get', path: PATH, summary: 'Sendungen, neueste zuerst (Filter: Zustand, Auftrag)', tags: TAGS, query: ShipmentQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(ShipmentDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Sendung zu einem Auslagerauftrag anlegen (übernimmt die Lieferadresse)', tags: TAGS, body: CreateShipmentSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{number}`, summary: 'Sendung mit TUs und – nach dem Warenausgang – ihrem Inhalt', tags: TAGS, params: p, response: one, errors: [404] });
    docs.route({ method: 'post', path: `${PATH}/{number}/units`, summary: 'Versand-TU vom Packplatz aufnehmen', tags: TAGS, params: p, body: AddShipmentUnitSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: `${PATH}/{number}/units/{barcode}`, summary: 'TU aus der Sendung nehmen', tags: TAGS, params: ShipmentUnitParam, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/load`, summary: 'Ladekontrolle: gescannte TU als verladen markieren; alle verladen → LOADED', tags: TAGS, params: p, body: LoadShipmentUnitSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/ship`, summary: 'Warenausgang: Bestand ausbuchen (SHIP), TUs löschen, Inhalt in der Sendung behalten', tags: TAGS, params: p, body: ShipShipmentSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/cancel`, summary: 'Sendung stornieren (TUs und Bestand bleiben)', tags: TAGS, params: p, body: CancelShipmentSchema, response: one, errors: [404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(ShipmentQuerySchema)) query: ShipmentQuery): Promise<{ items: ShipmentDto[]; total: number }> {
    const { items, total } = await this.shipments.list(query);
    return { items: items.map(toShipmentDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateShipmentSchema)) body: CreateShipment): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.create(body));
  }

  @Get(':number')
  async get(@Param(new ZodValidationPipe(ShipmentParam)) { number }: NumberParam): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.get(number));
  }

  @Post(':number/units')
  @HttpCode(HttpStatus.OK)
  async add(@Param(new ZodValidationPipe(ShipmentParam)) { number }: NumberParam, @Body(new ZodValidationPipe(AddShipmentUnitSchema)) body: AddShipmentUnit): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.add(number, body.barcode));
  }

  @Delete(':number/units/:barcode')
  async remove(@Param(new ZodValidationPipe(ShipmentUnitParam)) { number, barcode }: { number: string; barcode: string }): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.remove(number, barcode));
  }

  @Post(':number/load')
  @HttpCode(HttpStatus.OK)
  async load(@Param(new ZodValidationPipe(ShipmentParam)) { number }: NumberParam, @Body(new ZodValidationPipe(LoadShipmentUnitSchema)) body: LoadShipmentUnit): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.loadUnit(number, body));
  }

  @Post(':number/ship')
  @HttpCode(HttpStatus.OK)
  async ship(@Param(new ZodValidationPipe(ShipmentParam)) { number }: NumberParam, @Body(new ZodValidationPipe(ShipShipmentSchema)) body: ShipShipment): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.ship(number, body));
  }

  @Post(':number/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param(new ZodValidationPipe(ShipmentParam)) { number }: NumberParam, @Body(new ZodValidationPipe(CancelShipmentSchema)) body: CancelShipment): Promise<ShipmentDto> {
    return toShipmentDto(await this.shipments.cancel(number, body));
  }
}
