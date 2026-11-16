import { MikroORM } from '@mikro-orm/postgresql';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { ApiDocumentation } from '../../http/openapi/api-documentation.js';
import { EVENT_PUBLISHER, type EventPublisher } from '../../infrastructure/messaging/event-publisher.js';

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    checks: z.object({
      database: z.enum(['up', 'down']),
      mqtt: z.enum(['up', 'down']),
    }),
  })
  .meta({ id: 'Health', description: 'ok = alles erreichbar, degraded = MQTT fehlt (Events werden gepuffert), down = Datenbank fehlt' });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

@Controller('health')
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    documentation: ApiDocumentation,
  ) {
    documentation.registerPath({
      method: 'get',
      path: '/health',
      summary: 'Betriebszustand der API',
      responses: {
        200: { description: 'Datenbank erreichbar', content: { 'application/json': { schema: HealthResponseSchema } } },
        503: { description: 'Datenbank nicht erreichbar', content: { 'application/json': { schema: HealthResponseSchema } } },
      },
    });
  }

  @Get()
  async check(): Promise<HealthResponse> {
    const database = (await this.orm.isConnected()) ? 'up' : 'down';
    const mqtt = this.publisher.isConnected() ? 'up' : 'down';
    const body: HealthResponse = {
      status: database === 'down' ? 'down' : mqtt === 'down' ? 'degraded' : 'ok',
      checks: { database, mqtt },
    };
    if (body.status === 'down') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
