import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Quantity } from '@wms/shared';
import { z } from 'zod';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import type { Location } from '../../layout/index.js';
import type { TransportUnit } from '../../transport/index.js';
import { availableOf, InventoryService, isoDate } from '../application/inventory.service.js';
import type { Product, StockBooking, StockItem, StockReservation } from '../entities/inventory.entities.js';
import {
  BookingResultSchema,
  type CreateProduct,
  CreateProductSchema,
  type IssueInput,
  IssueSchema,
  type JournalQuery,
  JournalQuerySchema,
  pageOf,
  type ProductDto,
  ProductDtoSchema,
  ProductQuerySchema,
  type ProductUnitsInput,
  ProductUnitsSchema,
  type ReservationDto,
  ReservationDtoSchema,
  ReservationIdParam,
  type ReservationQuery,
  ReservationQuerySchema,
  type ReserveInput,
  ReserveSchema,
  SkuParam,
  type StockBookingDto,
  StockBookingDtoSchema,
  type StockCorrection,
  StockCorrectionSchema,
  type StockItemDto,
  StockItemDtoSchema,
  StockItemIdParam,
  type StockQuery,
  StockQuerySchema,
  type SummaryQuery,
  SummaryQuerySchema,
  SummaryRowSchema,
  type TransferInput,
  TransferResultSchema,
  TransferSchema,
  type UpdateProduct,
  UpdateProductSchema,
} from './schemas.js';

const TAGS = ['Bestand'];
type Units = { unit: string; factor: string }[];
const q = (amount: string, unit: string) => ({ amount: normalizeDecimal(amount), unit }) as StockItemDto['quantity'];

export const toProductDto = (p: Product, units: Units = []): ProductDto => ({
  sku: p.sku,
  description: p.description,
  baseUnit: p.baseUnit,
  units,
  overdeliveryAllowed: p.overdeliveryAllowed,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const toStockItemDto = (i: StockItem): StockItemDto => {
  const unit = i.unit as TransportUnit;
  const location = unit.location as Location;
  return {
    id: i.id,
    sku: (i.product as Product).sku,
    barcode: unit.barcode,
    location: { id: location.id, locationId: location.locationId },
    quantity: q(i.quantity, i.unitCode),
    reserved: q(i.reserved, i.unitCode),
    available: availableOf(i).toDto() as StockItemDto['quantity'],
    lot: i.lot ?? null,
    bestBefore: isoDate(i.bestBefore),
    updatedAt: i.updatedAt.toISOString(),
  };
};

const toBookingDto = (b: StockBooking): StockBookingDto => ({
  id: b.id,
  type: b.type,
  sku: b.sku,
  barcode: b.barcode,
  quantity: q(b.quantity, b.unitCode),
  lot: b.lot ?? null,
  bestBefore: isoDate(b.bestBefore),
  reference: b.reference,
  createdAt: b.createdAt.toISOString(),
});

const toReservationDto = (r: StockReservation): ReservationDto => {
  const item = r.item as StockItem;
  return {
    id: r.id,
    stockItemId: item.id,
    sku: (item.product as Product).sku,
    barcode: (item.unit as TransportUnit).barcode,
    quantity: q(r.quantity, r.unitCode),
    reference: r.reference,
    createdAt: r.createdAt.toISOString(),
  };
};

type BookingResult = z.infer<typeof BookingResultSchema>;
const toBookingResult = ({ booking, onHand, removed }: { booking: StockBooking; onHand: Quantity; removed: boolean }): BookingResult => ({
  bookingId: booking.id,
  onHand: onHand.toDto() as BookingResult['onHand'],
  removed,
});

@Controller('v1')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Produkt', schema: ProductDtoSchema };
    const booked = { status: 200, description: 'Gebucht', schema: BookingResultSchema };
    const id = StockItemIdParam;
    docs.route({ method: 'get', path: '/v1/products', summary: 'Produkte', tags: TAGS, query: ProductQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(ProductDtoSchema) } });
    docs.route({ method: 'post', path: '/v1/products', summary: 'Produkt anlegen', tags: TAGS, body: CreateProductSchema, response: { ...one, status: 201 }, errors: [400, 409] });
    docs.route({ method: 'get', path: '/v1/products/{sku}', summary: 'Produkt lesen', tags: TAGS, params: SkuParam, response: one, errors: [404] });
    docs.route({ method: 'patch', path: '/v1/products/{sku}', summary: 'Produkt ändern', tags: TAGS, params: SkuParam, body: UpdateProductSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'put', path: '/v1/products/{sku}/units', summary: 'Alternative Einheiten ersetzen', tags: TAGS, params: SkuParam, body: ProductUnitsSchema, response: one, errors: [400, 404] });
    docs.route({ method: 'get', path: '/v1/stock', summary: 'Bestandsposten je TU (Filter: Barcode, SKU, Charge, Platz, Gruppe)', tags: TAGS, query: StockQuerySchema, response: { status: 200, description: 'Bestandsposten', schema: pageOf(StockItemDtoSchema) } });
    docs.route({ method: 'get', path: '/v1/stock/summary', summary: 'Summen je Produkt oder je Platz und Produkt', tags: TAGS, query: SummaryQuerySchema, response: { status: 200, description: 'Summen', schema: pageOf(SummaryRowSchema) } });
    docs.route({ method: 'post', path: '/v1/stock/{id}/corrections', summary: 'Bestandskorrektur mit Grund', tags: TAGS, params: id, body: StockCorrectionSchema, response: booked, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/stock/{id}/issues', summary: 'Abgang (optional gegen eine Reservierung)', tags: TAGS, params: id, body: IssueSchema, response: booked, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/stock/{id}/transfers', summary: 'Teilmenge auf eine andere TU umbuchen', tags: TAGS, params: id, body: TransferSchema, response: { status: 200, description: 'Umgebucht', schema: TransferResultSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/stock/{id}/reservations', summary: 'Verfügbaren Bestand reservieren', tags: TAGS, params: id, body: ReserveSchema, response: { status: 201, description: 'Reserviert', schema: ReservationDtoSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/stock-reservations', summary: 'Reservierungen', tags: TAGS, query: ReservationQuerySchema, response: { status: 200, description: 'Reservierungen', schema: pageOf(ReservationDtoSchema) } });
    docs.route({ method: 'delete', path: '/v1/stock-reservations/{id}', summary: 'Reservierung aufheben', tags: TAGS, params: ReservationIdParam, response: { status: 204, description: 'Aufgehoben' }, errors: [404, 409] });
    docs.route({ method: 'get', path: '/v1/stock-bookings', summary: 'Buchungsjournal (neueste zuerst)', tags: TAGS, query: JournalQuerySchema, response: { status: 200, description: 'Buchungen', schema: pageOf(StockBookingDtoSchema) } });
  }

  @Get('products')
  async listProducts(@Query(new ZodValidationPipe(ProductQuerySchema)) query: z.infer<typeof ProductQuerySchema>): Promise<{ items: ProductDto[]; total: number }> {
    const [items, total] = await this.inventory.listProducts(query.limit, query.offset);
    const units = await this.inventory.unitsOf(items);
    return { items: items.map((p) => toProductDto(p, units.get(p.id))), total };
  }

  @Post('products')
  async createProduct(@Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProduct): Promise<ProductDto> {
    return this.productDto(await this.inventory.createProduct(body));
  }

  @Get('products/:sku')
  async getProduct(@Param(new ZodValidationPipe(SkuParam)) { sku }: { sku: string }): Promise<ProductDto> {
    return this.productDto(await this.inventory.getProduct(sku));
  }

  @Patch('products/:sku')
  async updateProduct(@Param(new ZodValidationPipe(SkuParam)) { sku }: { sku: string }, @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProduct): Promise<ProductDto> {
    return this.productDto(await this.inventory.updateProduct(sku, body));
  }

  @Put('products/:sku/units')
  async replaceUnits(@Param(new ZodValidationPipe(SkuParam)) { sku }: { sku: string }, @Body(new ZodValidationPipe(ProductUnitsSchema)) body: ProductUnitsInput): Promise<ProductDto> {
    return this.productDto(await this.inventory.replaceUnits(sku, body));
  }

  @Get('stock')
  async stock(@Query(new ZodValidationPipe(StockQuerySchema)) query: StockQuery): Promise<{ items: StockItemDto[]; total: number }> {
    const [items, total] = await this.inventory.listStock(query);
    return { items: items.map(toStockItemDto), total };
  }

  @Get('stock/summary')
  async summary(@Query(new ZodValidationPipe(SummaryQuerySchema)) query: SummaryQuery): Promise<{ items: z.infer<typeof SummaryRowSchema>[]; total: number }> {
    const { items, total } = await this.inventory.summary(query);
    return {
      items: items.map((r) => ({ sku: r.sku, location: r.location, onHand: q(r.onHand, r.unit), reserved: q(r.reserved, r.unit), available: q(r.available, r.unit), items: r.items, units: r.units })),
      total,
    };
  }

  @Post('stock/:id/corrections')
  @HttpCode(HttpStatus.OK)
  async correct(@Param(new ZodValidationPipe(StockItemIdParam)) { id }: { id: string }, @Body(new ZodValidationPipe(StockCorrectionSchema)) body: StockCorrection): Promise<BookingResult> {
    return toBookingResult(await this.inventory.correct(id, body));
  }

  @Post('stock/:id/issues')
  @HttpCode(HttpStatus.OK)
  async issue(@Param(new ZodValidationPipe(StockItemIdParam)) { id }: { id: string }, @Body(new ZodValidationPipe(IssueSchema)) body: IssueInput): Promise<BookingResult> {
    return toBookingResult(await this.inventory.issue(id, body));
  }

  @Post('stock/:id/transfers')
  @HttpCode(HttpStatus.OK)
  async transfer(@Param(new ZodValidationPipe(StockItemIdParam)) { id }: { id: string }, @Body(new ZodValidationPipe(TransferSchema)) body: TransferInput): Promise<z.infer<typeof TransferResultSchema>> {
    const r = await this.inventory.transfer(id, body);
    return {
      transferId: r.transferId,
      from: { id: r.from.id, onHand: r.fromRemoved ? q('0', r.from.unitCode) : q(r.from.quantity, r.from.unitCode), removed: r.fromRemoved },
      to: { id: r.to.id, onHand: q(r.to.quantity, r.to.unitCode) },
    };
  }

  @Post('stock/:id/reservations')
  async reserve(@Param(new ZodValidationPipe(StockItemIdParam)) { id }: { id: string }, @Body(new ZodValidationPipe(ReserveSchema)) body: ReserveInput): Promise<ReservationDto> {
    return toReservationDto(await this.inventory.reserve(id, body));
  }

  @Get('stock-reservations')
  async reservations(@Query(new ZodValidationPipe(ReservationQuerySchema)) query: ReservationQuery): Promise<{ items: ReservationDto[]; total: number }> {
    const [items, total] = await this.inventory.listReservations(query);
    return { items: items.map(toReservationDto), total };
  }

  @Delete('stock-reservations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async release(@Param(new ZodValidationPipe(ReservationIdParam)) { id }: { id: string }): Promise<void> {
    await this.inventory.releaseReservation(id);
  }

  @Get('stock-bookings')
  async journal(@Query(new ZodValidationPipe(JournalQuerySchema)) query: JournalQuery): Promise<{ items: StockBookingDto[]; total: number }> {
    const [items, total] = await this.inventory.listJournal(query);
    return { items: items.map(toBookingDto), total };
  }

  private async productDto(product: Product): Promise<ProductDto> {
    return toProductDto(product, (await this.inventory.unitsOf([product])).get(product.id));
  }
}
