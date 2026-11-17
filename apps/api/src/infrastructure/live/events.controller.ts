import { Controller, type MessageEvent, Query, Sse } from '@nestjs/common';
import { EventEnvelopeSchema } from '@wms/shared';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { z } from 'zod';
import { ApiDocumentation } from '../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../http/zod-validation.pipe.js';
import { EventStreamService } from './event-stream.service.js';

const HEARTBEAT_MS = 20_000;

export const EventStreamQuerySchema = z.object({
  types: z.string().max(500).optional().meta({ description: 'Kommagetrennte Ereignistypen, `*` als Platzhalter, z. B. `stock.*,transport-order.*`' }),
});

/** Ereignistyp gegen eine Liste mit `*` als Platzhalter. */
export function typeFilter(types: string | undefined): (type: string) => boolean {
  const patterns = (types ?? '*')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
  return (type) => patterns.length === 0 || patterns.some((r) => r.test(type));
}

@Controller('v1/events')
export class EventsController {
  constructor(
    private readonly stream: EventStreamService,
    docs: ApiDocumentation,
  ) {
    docs.route({
      method: 'get',
      path: '/v1/events/stream',
      summary: 'Live-Ereignisse als Server-Sent Events (text/event-stream); jede Nachricht ist ein Ereignis, alle 20 s ein ping',
      tags: ['Ereignisse'],
      query: EventStreamQuerySchema,
      response: { status: 200, description: 'Ereignisstrom (Format je Nachricht)', schema: EventEnvelopeSchema },
    });
  }

  @Sse('stream')
  stream$(@Query(new ZodValidationPipe(EventStreamQuerySchema)) query: z.infer<typeof EventStreamQuerySchema>): Observable<MessageEvent> {
    const accept = typeFilter(query.types);
    const events = this.stream.events().pipe(
      filter((e) => accept(e.type)),
      map((e): MessageEvent => ({ id: e.id, type: 'wms', data: e })),
    );
    // Regelmäßiges Lebenszeichen, damit Proxys die Verbindung nicht schließen.
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })));
    return merge(events, heartbeat);
  }
}
