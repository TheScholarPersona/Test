import { BarcodeSchema, LocationGroupNameSchema, LotSchema, QuantitySchema, SkuSchema, UnitCodeSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';

export { pageOf };

export const SkuParam = z.object({ sku: SkuSchema });

const Factor = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, 'Faktor als Dezimal-String, z. B. "12" oder "0.5"')
  .refine((v) => !/^0+(\.0+)?$/.test(v), 'Faktor muss größer als 0 sein');

export const ProductUnitSchema = z.strictObject({
  unit: UnitCodeSchema,
  factor: Factor.meta({ description: 'Basiseinheiten je Einheit, z. B. 1 KAR = 12 PCS → "12"' }),
});

export const CreateProductSchema = z
  .strictObject({
    sku: SkuSchema,
    description: z.string().trim().max(255).default(''),
    baseUnit: UnitCodeSchema,
    overdeliveryAllowed: z.boolean().default(false),
    units: z.array(ProductUnitSchema).max(20).default([]).meta({ description: 'Alternative Einheiten für Buchungen; Bestand bleibt in der Basiseinheit' }),
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

export const ProductUnitsSchema = z.strictObject({ units: z.array(ProductUnitSchema).max(20) }).meta({ id: 'ProductUnits' });
export type ProductUnitsInput = z.infer<typeof ProductUnitsSchema>;

export const ProductDtoSchema = z
  .object({
    sku: z.string(),
    description: z.string(),
    baseUnit: z.string(),
    units: z.array(z.object({ unit: z.string(), factor: z.string() })),
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
  lot: LotSchema.optional(),
  location: z.uuid().optional().meta({ description: 'Platz-id' }),
  group: LocationGroupNameSchema.optional().meta({ description: 'Gruppe inkl. Untergruppen' }),
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
    reserved: QuantitySchema,
    available: QuantitySchema,
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

const PositiveQuantity = QuantitySchema.meta({ description: 'In der Basiseinheit oder einer alternativen Einheit des Produkts' });
const Reference = z.string().trim().min(1).max(120);

export const IssueSchema = z
  .strictObject({
    quantity: PositiveQuantity,
    reference: Reference.meta({ description: 'Fachlicher Bezug, z. B. Auftragsnummer' }),
    reservationId: z.uuid().optional().meta({ description: 'Reservierung, die der Abgang verbraucht' }),
  })
  .meta({ id: 'StockIssue' });
export type IssueInput = z.infer<typeof IssueSchema>;

export const TransferSchema = z
  .strictObject({ to: BarcodeSchema.meta({ description: 'Ziel-TU' }), quantity: PositiveQuantity, reference: Reference.optional() })
  .meta({ id: 'StockTransfer' });
export type TransferInput = z.infer<typeof TransferSchema>;

export const ReserveSchema = z.strictObject({ quantity: PositiveQuantity, reference: Reference }).meta({ id: 'StockReserve' });
export type ReserveInput = z.infer<typeof ReserveSchema>;

export const ReservationIdParam = z.object({ id: z.uuid() });

export const ReservationQuerySchema = z.object({
  reference: Reference.optional(),
  barcode: BarcodeSchema.optional(),
  sku: SkuSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReservationQuery = z.infer<typeof ReservationQuerySchema>;

export const ReservationDtoSchema = z
  .object({ id: z.uuid(), stockItemId: z.uuid(), sku: z.string(), barcode: z.string(), quantity: QuantitySchema, reference: z.string(), createdAt: z.iso.datetime() })
  .meta({ id: 'StockReservation' });
export type ReservationDto = z.infer<typeof ReservationDtoSchema>;

export const BookingResultSchema = z
  .object({ bookingId: z.uuid(), onHand: QuantitySchema, removed: z.boolean().meta({ description: 'Posten auf 0 gefallen und entfernt' }) })
  .meta({ id: 'StockBookingResult' });

export const TransferResultSchema = z
  .object({ transferId: z.uuid(), from: z.object({ id: z.uuid(), onHand: QuantitySchema, removed: z.boolean() }), to: z.object({ id: z.uuid(), onHand: QuantitySchema }) })
  .meta({ id: 'StockTransferResult' });

export const SummaryQuerySchema = z.object({
  by: z.enum(['product', 'location']).default('product'),
  sku: SkuSchema.optional(),
  group: LocationGroupNameSchema.optional().meta({ description: 'Nur Plätze dieser Gruppe inkl. Untergruppen' }),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;

export const SummaryRowSchema = z
  .object({
    sku: z.string(),
    location: z.object({ id: z.uuid(), locationId: z.string() }).nullable(),
    onHand: QuantitySchema,
    reserved: QuantitySchema,
    available: QuantitySchema,
    items: z.number().int(),
    units: z.number().int().meta({ description: 'Anzahl TUs' }),
  })
  .meta({ id: 'StockSummaryRow' });

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

// --- Inventur ------------------------------------------------------------------

export const CountNumberParam = z.object({ number: z.string().regex(/^IN\d{8}$/, 'Inventurnummer im Format IN00000001') });

export const OpenCountSchema = z
  .strictObject({ barcode: BarcodeSchema, reference: z.string().trim().min(1).max(120).optional() })
  .meta({ id: 'OpenStockCount' });
export type OpenCount = z.infer<typeof OpenCountSchema>;

export const RecordCountSchema = z
  .strictObject({
    lines: z
      .array(
        z.strictObject({
          sku: SkuSchema,
          lot: LotSchema.optional(),
          bestBefore: z.iso.date().optional(),
          quantity: QuantitySchema.meta({ description: 'Gezählte Menge (0 erlaubt), Basis- oder alternative Einheit' }),
        }),
      )
      .max(1000),
    countedBy: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: 'RecordStockCount', description: 'Nicht genannte Soll-Zeilen gelten als nicht gefunden (0)' });
export type RecordCount = z.infer<typeof RecordCountSchema>;

export const CountQuerySchema = z.object({
  barcode: BarcodeSchema.optional(),
  state: z.enum(['OPEN', 'COUNTED', 'CLOSED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CountQuery = z.infer<typeof CountQuerySchema>;

export const CountDtoSchema = z
  .object({
    number: z.string(),
    barcode: z.string(),
    state: z.enum(['OPEN', 'COUNTED', 'CLOSED', 'CANCELLED']),
    reference: z.string().nullable(),
    countedBy: z.string().nullable(),
    countedAt: z.iso.datetime().nullable(),
    closedAt: z.iso.datetime().nullable(),
    lines: z.array(
      z.object({
        sku: z.string(),
        lot: z.string().nullable(),
        bestBefore: z.iso.date().nullable(),
        expected: QuantitySchema,
        counted: QuantitySchema.nullable(),
        difference: QuantitySchema.nullable(),
      }),
    ),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'StockCount' });
export type CountDto = z.infer<typeof CountDtoSchema>;
