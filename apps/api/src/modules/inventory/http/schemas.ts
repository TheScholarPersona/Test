import { BarcodeSchema, LotSchema, QuantitySchema, SkuSchema, UnitCodeSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';

export { pageOf };

export const SkuParam = z.object({ sku: SkuSchema });

export const CreateProductSchema = z
  .strictObject({
    sku: SkuSchema,
    description: z.string().trim().max(255).default(''),
    baseUnit: UnitCodeSchema,
    overdeliveryAllowed: z.boolean().default(false),
  })
  .meta({ id: 'CreateProduct' });
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z
  .strictObject({
    description: z.string().trim().max(255).optional(),
    baseUnit: UnitCodeSchema.optional().meta({ description: 'Nur änderbar, solange kein Bestand existiert' }),
    overdeliveryAllowed: z.boolean().optional(),
  })
  .meta({ id: 'UpdateProduct' });
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;

export const ProductDtoSchema = z
  .object({
    sku: z.string(),
    description: z.string(),
    baseUnit: z.string(),
    overdeliveryAllowed: z.boolean(),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Product' });
export type ProductDto = z.infer<typeof ProductDtoSchema>;

export const ProductQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const StockQuerySchema = z.object({
  barcode: BarcodeSchema.optional(),
  sku: SkuSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type StockQuery = z.infer<typeof StockQuerySchema>;

export const StockItemDtoSchema = z
  .object({
    id: z.uuid(),
    sku: z.string(),
    barcode: z.string(),
    location: z.object({ id: z.uuid(), locationId: z.string() }),
    quantity: QuantitySchema,
    lot: z.string().nullable(),
    bestBefore: z.iso.date().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'StockItem' });
export type StockItemDto = z.infer<typeof StockItemDtoSchema>;

export const StockItemIdParam = z.object({ id: z.uuid() });

export const StockCorrectionSchema = z
  .strictObject({
    delta: QuantitySchema.refine((q) => !/^-?0+(\.0+)?$/.test(q.amount), { message: 'Korrektur darf nicht 0 sein' }).meta({
      description: 'Vorzeichenbehaftete Änderung in der Einheit des Postens, z. B. "-2"',
    }),
    reason: z.string().trim().min(1).max(200),
  })
  .meta({ id: 'StockCorrection' });
export type StockCorrection = z.infer<typeof StockCorrectionSchema>;

export const StockCorrectionResultSchema = z
  .object({ bookingId: z.uuid(), onHand: QuantitySchema, removed: z.boolean().meta({ description: 'Posten auf 0 gefallen und entfernt' }) })
  .meta({ id: 'StockCorrectionResult' });

export const JournalQuerySchema = z.object({
  sku: SkuSchema.optional(),
  barcode: BarcodeSchema.optional(),
  reference: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type JournalQuery = z.infer<typeof JournalQuerySchema>;

export const StockBookingDtoSchema = z
  .object({
    id: z.uuid(),
    type: z.string(),
    sku: z.string(),
    barcode: z.string(),
    quantity: QuantitySchema,
    lot: z.string().nullable(),
    bestBefore: z.iso.date().nullable(),
    reference: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'StockBooking' });
export type StockBookingDto = z.infer<typeof StockBookingDtoSchema>;

export { LotSchema };
