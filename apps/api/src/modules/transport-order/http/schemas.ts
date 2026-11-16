import { BarcodeSchema, LocationGroupNameSchema, TransportOrderPrioritySchema, TransportOrderStateSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';

export { pageOf };

export const TransportOrderNumberParam = z.object({ number: z.string().regex(/^TO\d{8}$/, 'Auftragsnummer im Format TO00000001') });

const Reason = z.string().trim().min(1).max(200);

export const TransportOrderTargetSchema = z
  .union([z.strictObject({ location: LocationReferenceSchema }), z.strictObject({ group: LocationGroupNameSchema })])
  .meta({ id: 'TransportOrderTarget', description: 'Zielplatz oder Zielgruppe (der Platz ergibt sich dann aus dem Materialfluss)' });

export const CreateTransportOrderSchema = z
  .strictObject({
    barcode: BarcodeSchema,
    target: TransportOrderTargetSchema,
    priority: TransportOrderPrioritySchema.default('NORMAL'),
    redirect: z.boolean().default(false).meta({ description: 'Bei gesperrtem Zielplatz per Einlagerstrategie in dessen Gruppe umleiten (O-07)' }),
    autoStart: z.boolean().default(true).meta({ description: 'Sofort starten, wenn möglich; sonst bleibt der Auftrag INITIALIZED mit Problem' }),
    initiator: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: 'CreateTransportOrder' });
export type CreateTransportOrder = z.infer<typeof CreateTransportOrderSchema>;

export const ReasonSchema = z.strictObject({ reason: Reason.optional() }).meta({ id: 'TransportOrderReason' });
export type ReasonInput = z.infer<typeof ReasonSchema>;

export const FailSchema = z
  .strictObject({ code: z.string().trim().regex(/^[A-Z0-9_]{1,60}$/).default('FAILED'), reason: Reason })
  .meta({ id: 'FailTransportOrder' });
export type FailInput = z.infer<typeof FailSchema>;

export const FinishSchema = z
  .strictObject({
    location: LocationReferenceSchema.optional().meta({ description: 'Tatsächlicher Abstellplatz; ohne Angabe Zielplatz bzw. aktueller Platz (bei Zielgruppe)' }),
    mode: z.enum(['checked', 'physical']).default('physical').meta({ description: 'Anlagen melden Tatsachen, deshalb standardmäßig physical' }),
  })
  .meta({ id: 'FinishTransportOrder' });
export type FinishInput = z.infer<typeof FinishSchema>;

const splitCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

export const TransportOrderQuerySchema = z.object({
  state: z.string().transform(splitCsv).pipe(z.array(TransportOrderStateSchema).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. INITIALIZED,STARTED' }),
  barcode: BarcodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TransportOrderQuery = z.infer<typeof TransportOrderQuerySchema>;

const PlaceSchema = z.object({ id: z.uuid().nullable().meta({ description: 'null, wenn der Platz inzwischen gelöscht wurde' }), locationId: z.string() });

export const TransportOrderDtoSchema = z
  .object({
    number: z.string(),
    barcode: z.string(),
    state: TransportOrderStateSchema,
    priority: TransportOrderPrioritySchema,
    source: PlaceSchema,
    target: PlaceSchema.nullable(),
    targetGroup: z.string().nullable(),
    redirect: z.boolean(),
    decisionId: z.uuid().nullable(),
    initiator: z.string().nullable(),
    problem: z.object({ code: z.string(), message: z.string(), at: z.iso.datetime() }).nullable(),
    startedAt: z.iso.datetime().nullable(),
    finished: z.object({ at: z.iso.datetime(), locationId: z.string(), deviated: z.boolean() }).nullable(),
    ended: z.object({ at: z.iso.datetime(), reason: z.string().nullable() }).nullable(),
    allowedActions: z.array(z.enum(['start', 'interrupt', 'resume', 'finish', 'cancel', 'fail'])),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'TransportOrder' });
export type TransportOrderDto = z.infer<typeof TransportOrderDtoSchema>;

export const StartPendingResultSchema = z
  .object({
    started: z.array(z.string()),
    blocked: z.array(z.object({ number: z.string(), code: z.string(), message: z.string() })),
  })
  .meta({ id: 'StartPendingResult' });
