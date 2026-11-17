import { EntityManager } from '@mikro-orm/postgresql';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SystemPingEvent } from '@wms/shared';
import { z } from 'zod';
import { ApiDocumentation } from '../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../http/zod-validation.pipe.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export const PingRequestSchema = z
  .object({
    message: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(100).optional(),
  })
  .meta({ id: 'PingRequest' });
export type PingRequest = z.infer<typeof PingRequestSchema>;

export const PingResponseSchema = z
  .object({
    eventId: z.uuid(),
    topic: z.string(),
  })
  .meta({ id: 'PingResponse' });
export type PingResponse = z.infer<typeof PingResponseSchema>;

/**
 * Endpunkte nur für automatisierte Tests (Profil `test`).
 * Im Profil `production` wird dieses Modul nicht geladen.
 */
@Controller('test')
export class TestSupportController {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    documentation: ApiDocumentation,
  ) {
    documentation.registerPath({
      method: 'post',
      path: '/test/events/ping',
      summary: 'Nur Testprofil: erzeugt ein system.ping-Event über die Outbox',
      tags: ['Test'],
      request: { body: { content: { 'application/json': { schema: PingRequestSchema } } } },
      responses: {
        201: { description: 'Event in der Outbox gespeichert', content: { 'application/json': { schema: PingResponseSchema } } },
        400: { description: 'Ungültige Anfrage' },
      },
    });
  }

  @Post('events/ping')
  @HttpCode(HttpStatus.CREATED)
  async ping(@Body(new ZodValidationPipe(PingRequestSchema)) body: PingRequest): Promise<PingResponse> {
    const envelope = await this.em.fork().transactional((tx) =>
      Promise.resolve(this.outbox.record(tx, SystemPingEvent, { message: body.message }, { correlationId: body.correlationId })),
    );
    return { eventId: envelope.id, topic: SystemPingEvent.topic };
  }
}
