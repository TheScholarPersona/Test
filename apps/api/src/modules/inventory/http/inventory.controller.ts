import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import type { Location } from '../../layout/index.js';
import type { TransportUnit } from '../../transport/index.js';
import { InventoryService, isoDate } from '../application/inventory.service.js';
import type { Product, StockBooking, StockItem } from '../entities/inventory.entities.js';
import {
  type CreateProduct,
  CreateProductSchema,
  type JournalQuery,
  JournalQuerySchema,
  pageOf,
  type ProductDto,
  ProductDtoSchema,
  ProductQuerySchema,
  SkuParam,
  type StockCorrection,
  StockCorrectionResultSchema,
  StockCorrectionSchema,
  StockItemIdParam,
  type StockBookingDto,
  StockBookingDtoSchema,
  type StockItemDto,
  StockItemDtoSchema,
  type StockQuery,
  StockQuerySchema,
  type UpdateProduct,
  UpdateProductSchema,
} from './schemas.js';

const TAGS = ['Bestand'];

export const toProductDto = (p: Product): ProductDto => ({
  sku: p.sku,
  description: p.description,
  baseUnit: p.baseUnit,
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
    quantity: { amount: normalizeDecimal(i.quantity), unit: i.unitCode } as StockItemDto['quantity'],
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
  quantity: { amount: normalizeDecimal(b.quantity), unit: b.unitCode } as StockBookingDto['quantity'],
  lot: b.lot ?? null,
  bestBefore: isoDate(b.bestBefore),
  reference: b.reference,
  createdAt: b.createdAt.toISOString(),
});

@Controller('v1')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Produkt', schema: ProductDtoSchema };
    docs.route({ method: 'get', path: '/v1/products', summary: 'Produkte', tags: TAGS, query: ProductQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(ProductDtoSchema) } });
    docs.route({ method: 'post', path: '/v1/products', summary: 'Produkt anlegen', tags: TAGS, body: CreateProductSchema, response: { ...one, status: 201 }, errors: [400, 409] });
    docs.route({ method: 'get', path: '/v1/products/{sku}', summary: 'Produkt lesen', tags: TAGS, params: SkuParam, response: one, errors: [404] });
    docs.route({ method: 'patch', path: '/v1/products/{sku}', summary: 'Produkt ändern', tags: TAGS, params: SkuParam, body: UpdateProductSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/stock', summary: 'Bestand je TU (nach Barcode oder SKU)', tags: TAGS, query: StockQuerySchema, response: { status: 200, description: 'Bestandsposten', schema: pageOf(StockItemDtoSchema) } });
    docs.route({ method: 'post', path: '/v1/stock/{id}/corrections', summary: 'Bestandskorrektur mit Grund (kein negativer Bestand)', tags: TAGS, params: StockItemIdParam, body: StockCorrectionSchema, response: { status: 200, description: 'Gebucht', schema: StockCorrectionResultSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/stock-bookings', summary: 'Buchungsjournal (neueste zuerst)', tags: TAGS, query: JournalQuerySchema, response: { status: 200, description: 'Buchungen', schema: pageOf(StockBookingDtoSchema) } });
  }

  @Get('products')
  async listProducts(@Query(new ZodValidationPipe(ProductQuerySchema)) q: z.infer<typeof ProductQuerySchema>): Promise<{ items: ProductDto[]; total: number }> {
    const [items, total] = await this.inventory.listProducts(q.limit, q.offset);
    return { items: items.map(toProductDto), total };
  }

  @Post('products')
  async createProduct(@Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProduct): Promise<ProductDto> {
    return toProductDto(await this.inventory.createProduct(body));
  }

  @Get('products/:sku')
  async getProduct(@Param(new ZodValidationPipe(SkuParam)) { sku }: { sku: string }): Promise<ProductDto> {
    return toProductDto(await this.inventory.getProduct(sku));
  }

  @Patch('products/:sku')
  async updateProduct(
    @Param(new ZodValidationPipe(SkuParam)) { sku }: { sku: string },
    @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProduct,
  ): Promise<ProductDto> {
    return toProductDto(await this.inventory.updateProduct(sku, body));
  }

  @Get('stock')
  async stock(@Query(new ZodValidationPipe(StockQuerySchema)) query: StockQuery): Promise<{ items: StockItemDto[]; total: number }> {
    const [items, total] = await this.inventory.listStock(query);
    return { items: items.map(toStockItemDto), total };
  }

  @Post('stock/:id/corrections')
  @HttpCode(HttpStatus.OK)
  async correct(
    @Param(new ZodValidationPipe(StockItemIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(StockCorrectionSchema)) body: StockCorrection,
  ): Promise<z.infer<typeof StockCorrectionResultSchema>> {
    const { booking, onHand, removed } = await this.inventory.correct(id, body);
    return { bookingId: booking.id, onHand: onHand.toDto(), removed };
  }

  @Get('stock-bookings')
  async journal(@Query(new ZodValidationPipe(JournalQuerySchema)) query: JournalQuery): Promise<{ items: StockBookingDto[]; total: number }> {
    const [items, total] = await this.inventory.listJournal(query);
    return { items: items.map(toBookingDto), total };
  }
}
