import { ErpInboundMessageSchema, ErpOutboundMessageSchema, ErpOutboundTypeSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { ERP_DIRECTIONS, ERP_STATES } from '../entities/erp-message.entity.js';

export { pageOf };

const splitCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

export const InboundBodySchema = ErpInboundMessageSchema.meta({ id: 'ErpInboundMessage', description: 'Kanonische Nachricht vom ERP (Artikel, Avis, Auslagerauftrag)' });
export const ErpIdParam = z.object({ id: z.uuid() });

export const ClaimQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  type: z.string().transform(splitCsv).pipe(z.array(ErpOutboundTypeSchema).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. goods-receipt,goods-issue' }),
});
export type ClaimQuery = z.infer<typeof ClaimQuerySchema>;

export const AckSchema = z.strictObject({ erpReference: z.string().trim().min(1).max(100).optional().meta({ description: 'Beleg im ERP, z. B. Materialbelegnummer' }) }).meta({ id: 'ErpAck' });
export const NackSchema = z.strictObject({ error: z.string().trim().min(1).max(2000) }).meta({ id: 'ErpNack' });

export const ErpMessageQuerySchema = z.object({
  direction: z.enum(ERP_DIRECTIONS).optional(),
  state: z.string().transform(splitCsv).pipe(z.array(z.enum(ERP_STATES)).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. FAILED' }),
  type: z.string().trim().min(1).max(40).optional(),
  reference: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ErpMessageQuery = z.infer<typeof ErpMessageQuerySchema>;

export const ErpMessageDtoSchema = z
  .object({
    id: z.uuid(),
    direction: z.enum(ERP_DIRECTIONS),
    messageId: z.string(),
    type: z.string(),
    action: z.string().nullable(),
    state: z.enum(ERP_STATES),
    reference: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()).nullable(),
    attempts: z.number().int(),
    nextAttemptAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
    occurredAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ErpMessage' });
export type ErpMessageDto = z.infer<typeof ErpMessageDtoSchema>;

export const InboundResultSchema = z
  .object({ duplicate: z.boolean().meta({ description: 'Nachricht mit dieser ID war schon da; Ergebnis von damals' }), message: ErpMessageDtoSchema })
  .meta({ id: 'ErpInboundResult' });

export const ClaimedSchema = z
  .object({ items: z.array(z.object({ id: z.uuid(), attempts: z.number().int(), message: ErpOutboundMessageSchema })) })
  .meta({ id: 'ErpClaimed', description: 'Abgeholte Ausgangsnachrichten; jede mit ack oder nack quittieren' });

export const ErpCountsSchema = z.object({ items: z.array(z.object({ direction: z.string(), state: z.string(), count: z.number().int() })) }).meta({ id: 'ErpCounts' });
