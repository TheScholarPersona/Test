import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiDocumentation } from '../../http/openapi/api-documentation.js';
import { MetricsService } from './metrics.service.js';

type Response = { setHeader(name: string, value: string): void };

/** Prometheus-Endpunkt. Braucht eine Anmeldung (z. B. Service-Token mit Rolle `lesen`). */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    docs: ApiDocumentation,
  ) {
    docs.route({
      method: 'get',
      path: '/metrics',
      summary: 'Metriken im Prometheus-Format (Anfragen, Outbox, offene Aufträge, Prozess)',
      tags: ['Betrieb'],
      response: { status: 200, description: 'Prometheus-Text', binary: 'text/plain' },
    });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Res({ passthrough: true }) response: Response): Promise<string> {
    response.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.render();
  }
}
