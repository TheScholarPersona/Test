import {
  BarcodeSchema,
  LocationGroupNameSchema,
  LotSchema,
  QuantitySchema,
  ReceivingOrderStateSchema,
  ReceivingPositionStateSchema,
  SkuSchema,
  TransportUnitTypeCodeSchema,
} from '@wms/shared';
import { z } from 'zod';
import { PartnerCodeSchema } from '../../partner/index.js';
import { pageOf } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';

export { pageOf };

export const OrderIdSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/, 'Auftragsnummer: 1–64 Zeichen, Buchstaben, Ziffern und . _ - /');
export const OrderIdParam = z.object({ orderId: OrderIdSchema });
export const PositionParam = z.object({ orderId: OrderIdSchema, posNo: z.coerce.number().int().min(1) });

const PositiveQuantity = QuantitySchema.refine((q) => !/^-/.test(q.amount) && !/^0+(\.0+)?$/.test(q.amount), { message: 'Menge muss größer als 0 sein' });
const Actor = z.string().trim().min(1).max(100);

const QuantityPositionInput = z.strictObject({
  posNo: z.number().int().min(1).optional(),
  kind: z.literal('quantity'),
  sku: SkuSchema,
  quantity: PositiveQuantity,
});
const UnitPositionInput = z.strictObject({
  posNo: z.number().int().min(1).optional(),
  kind: z.literal('unit'),
  typeCode: TransportUnitTypeCodeSchema,
  barcode: BarcodeSchema.optional().meta({ description: 'Erwarteter Barcode, z. B. SSCC der avisierten Palette' }),
});

export const CreateReceivingOrderSchema = z
  .strictObject({
    orderId: OrderIdSchema,
    supplier: z.string().trim().min(1).max(100).optional().meta({ description: 'Freitext; mit supplierCode ohne Angabe die Partnernummer' }),
    supplierCode: PartnerCodeSchema.optional().meta({ description: 'Geschäftspartner mit Rolle SUPPLIER' }),
    expectedAt: z.iso.datetime({ offset: true }).optional(),
    positions: z.array(z.discriminatedUnion('kind', [QuantityPositionInput, UnitPositionInput])).min(1).max(500),
  })
  .meta({ id: 'CreateReceivingOrder', description: 'Positionen ohne posNo werden fortlaufend nummeriert' });
export type CreateReceivingOrder = z.infer<typeof CreateReceivingOrderSchema>;

/** Ziel-TU einer Mengenerfassung: bestehende TU per Barcode oder neue TU (Typ angeben). */
const TargetUnit = z.strictObject({
  barcode: BarcodeSchema.optional().meta({ description: 'Bestehende TU oder Barcode für die neue TU; ohne Angabe wird einer erzeugt' }),
  typeCode: TransportUnitTypeCodeSchema.optional().meta({ description: 'Pflicht, wenn die TU neu angelegt wird' }),
});

const CaptureCommon = {
  location: LocationReferenceSchema.meta({ description: 'Erfassungsplatz (Wareneingang)' }),
  capturedBy: Actor.optional(),
  putawayGroup: LocationGroupNameSchema.optional().meta({ description: 'Gleich eine Einlagerbewegung in diese Gruppe anlegen' }),
};

export const QuantityCaptureSchema = z.strictObject({
  kind: z.literal('quantity'),
  sku: SkuSchema,
  quantity: PositiveQuantity,
  unit: TargetUnit.default({}),
  lot: LotSchema.optional(),
  bestBefore: z.iso.date().optional(),
  ...CaptureCommon,
});
export const UnitCaptureSchema = z.strictObject({
  kind: z.literal('unit'),
  barcode: BarcodeSchema,
  typeCode: TransportUnitTypeCodeSchema.optional().meta({ description: 'Ohne Angabe der Typ aus der Avisposition' }),
  ...CaptureCommon,
});
export const CaptureSchema = z.discriminatedUnion('kind', [QuantityCaptureSchema, UnitCaptureSchema]).meta({ id: 'ReceivingCapture' });
export type CaptureInput = z.infer<typeof CaptureSchema>;
export type QuantityCapture = z.infer<typeof QuantityCaptureSchema>;
export type UnitCapture = z.infer<typeof UnitCaptureSchema>;

export const BlindCaptureSchema = QuantityCaptureSchema.omit({ kind: true }).meta({ id: 'BlindCapture', description: 'Wareneingang ohne Avis' });
export type BlindCapture = z.infer<typeof BlindCaptureSchema>;

export const ReasonSchema = z.strictObject({ reason: z.string().trim().min(1).max(200).optional() }).meta({ id: 'Reason' });

export const ReceivingQuerySchema = z.object({
  state: ReceivingOrderStateSchema.optional(),
  supplier: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReceivingQuery = z.infer<typeof ReceivingQuerySchema>;

export const PositionDtoSchema = z.object({
  posNo: z.number().int(),
  kind: z.enum(['quantity', 'unit']),
  state: ReceivingPositionStateSchema,
  sku: z.string().nullable(),
  expected: QuantitySchema.nullable(),
  received: QuantitySchema.nullable(),
  open: QuantitySchema.nullable().meta({ description: 'Restmenge (nicht negativ)' }),
  typeCode: z.string().nullable(),
  expectedBarcode: z.string().nullable(),
  receivedBarcode: z.string().nullable(),
  closeReason: z.string().nullable(),
});

export const ReceivingOrderDtoSchema = z
  .object({
    orderId: z.string(),
    supplier: z.string().nullable(),
    supplierCode: z.string().nullable(),
    expectedAt: z.iso.datetime().nullable(),
    state: ReceivingOrderStateSchema,
    positions: z.array(PositionDtoSchema),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ReceivingOrder' });
export type ReceivingOrderDto = z.infer<typeof ReceivingOrderDtoSchema>;

export const CaptureResultSchema = z
  .object({
    captureId: z.uuid(),
    kind: z.enum(['quantity', 'unit', 'blind']),
    posNo: z.number().int().nullable(),
    overdelivered: z.boolean(),
    barcode: z.string(),
    onHand: QuantitySchema.nullable().meta({ description: 'Bestand des Produkts auf der TU nach der Erfassung' }),
    movementNumber: z.string().nullable(),
    order: ReceivingOrderDtoSchema.nullable(),
  })
  .meta({ id: 'CaptureResult' });
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

export const CaptureDtoSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['quantity', 'unit', 'blind']),
    posNo: z.number().int().nullable(),
    sku: z.string().nullable(),
    quantity: QuantitySchema.nullable(),
    barcode: z.string(),
    locationId: z.string(),
    lot: z.string().nullable(),
    bestBefore: z.iso.date().nullable(),
    overdelivered: z.boolean(),
    capturedBy: z.string().nullable(),
    movementNumber: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ReceivingCaptureRecord' });
export type CaptureDto = z.infer<typeof CaptureDtoSchema>;
