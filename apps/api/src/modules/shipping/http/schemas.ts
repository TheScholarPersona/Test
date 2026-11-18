import { BarcodeSchema, QuantitySchema, ShipmentStateSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { PartnerCodeSchema } from '../../partner/index.js';

export { pageOf };

const splitCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);
const Actor = z.string().trim().min(1).max(100);
const OrderId = z.string().trim().min(1).max(40);

export const ShipmentParam = z.object({ number: z.string().trim().min(1).max(20) });
export const ShipmentUnitParam = z.object({ number: z.string().trim().min(1).max(20), barcode: BarcodeSchema });

export const CreateShipmentSchema = z
  .strictObject({
    orderId: OrderId.meta({ description: 'Auslagerauftrag; Lieferadresse und Kunde werden übernommen' }),
    carrierCode: PartnerCodeSchema.optional().meta({ description: 'Geschäftspartner mit Rolle CARRIER' }),
    units: z.array(BarcodeSchema).max(200).optional().meta({ description: 'Versand-TUs am Packplatz' }),
  })
  .meta({ id: 'CreateShipment' });
export type CreateShipment = z.infer<typeof CreateShipmentSchema>;

export const AddShipmentUnitSchema = z.strictObject({ barcode: BarcodeSchema }).meta({ id: 'AddShipmentUnit' });
export type AddShipmentUnit = z.infer<typeof AddShipmentUnitSchema>;

export const LoadShipmentUnitSchema = z
  .strictObject({ barcode: BarcodeSchema.meta({ description: 'Gescannter Barcode der TU' }), loadedBy: Actor.optional() })
  .meta({ id: 'LoadShipmentUnit' });
export type LoadShipmentUnit = z.infer<typeof LoadShipmentUnitSchema>;

export const ShipShipmentSchema = z.strictObject({ shippedBy: Actor.optional() }).meta({ id: 'ShipShipment' });
export type ShipShipment = z.infer<typeof ShipShipmentSchema>;

export const CancelShipmentSchema = z.strictObject({ reason: z.string().trim().min(1).max(200).optional() }).meta({ id: 'CancelShipment' });
export type CancelShipment = z.infer<typeof CancelShipmentSchema>;

export const ShipmentQuerySchema = z.object({
  state: z.string().transform(splitCsv).pipe(z.array(ShipmentStateSchema).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. OPEN,LOADED' }),
  orderId: OrderId.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ShipmentQuery = z.infer<typeof ShipmentQuerySchema>;

const ShipToSchema = z.object({ name: z.string().nullable(), street: z.string().nullable(), postalCode: z.string().nullable(), city: z.string().nullable(), country: z.string().nullable() });

export const ShipmentDtoSchema = z
  .object({
    number: z.string(),
    orderId: z.string(),
    customerCode: z.string().nullable(),
    shipTo: ShipToSchema.nullable(),
    carrierCode: z.string().nullable(),
    state: ShipmentStateSchema,
    units: z.array(
      z.object({
        barcode: z.string(),
        loaded: z.boolean(),
        loadedAt: z.iso.datetime().nullable(),
        loadedBy: z.string().nullable(),
        contents: z
          .array(z.object({ sku: z.string(), quantity: QuantitySchema, lot: z.string().nullable(), bestBefore: z.string().nullable() }))
          .nullable()
          .meta({ description: 'Inhalt beim Warenausgang; vorher null' }),
      }),
    ),
    counts: z.object({ units: z.number().int(), loaded: z.number().int() }),
    cancelReason: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: z.iso.datetime(),
    loadedAt: z.iso.datetime().nullable(),
    shippedAt: z.iso.datetime().nullable(),
    shippedBy: z.string().nullable(),
  })
  .meta({ id: 'Shipment' });
export type ShipmentDto = z.infer<typeof ShipmentDtoSchema>;
