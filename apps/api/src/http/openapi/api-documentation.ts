import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config.js';

export const ApiErrorSchema = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    code: z.string().meta({ description: 'Stabile Fehlerkennung, z. B. LOCK_INHERITED' }),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ApiError' });

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Ungültige Anfrage (Feldprüfung)',
  404: 'Nicht gefunden',
  409: 'Konflikt oder verletzte Geschäftsregel',
  401: 'Nicht angemeldet (UNAUTHENTICATED)',
  403: 'Rolle reicht nicht (FORBIDDEN)',
};

type ZodObjectLike = NonNullable<NonNullable<RouteConfig['request']>['params']>;

/** Kurzform für die Beschreibung eines Endpunkts. */
export interface RouteDoc {
  method: RouteConfig['method'];
  /** OpenAPI-Pfad, Parameter in geschweiften Klammern: `/v1/locations/{id}` */
  path: string;
  summary: string;
  tags: string[];
  params?: ZodObjectLike;
  query?: ZodObjectLike;
  body?: z.ZodType;
  response: { status: number; description: string; schema?: z.ZodType };
  errors?: (400 | 404 | 409)[];
  /** Ohne Anmeldung erreichbar (z. B. Login). Sonst: Bearer-Token oder Sitzungs-Cookie, Antworten 401/403. */
  public?: boolean;
}

/**
 * Sammelt die OpenAPI-Beschreibungen aller geladenen Module.
 * Jedes Modul registriert seine Endpunkte mit denselben Zod-Schemas,
 * die es auch zur Validierung nutzt – Dokumentation und Verhalten
 * können dadurch nicht auseinanderlaufen.
 */
@Injectable()
export class ApiDocumentation {
  private readonly registry = new OpenAPIRegistry();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.registry.registerComponent('securitySchemes', 'bearer', {
      type: 'http',
      scheme: 'bearer',
      description: 'Service-Token (Maschinen, z. B. Node-RED) oder Sitzungstoken',
    });
    this.registry.registerComponent('securitySchemes', 'session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'wms_session',
      description: 'Sitzungs-Cookie nach POST /v1/auth/login (Oberfläche)',
    });
  }

  registerPath(route: RouteConfig): void {
    this.registry.registerPath(route);
  }

  route(doc: RouteDoc): void {
    const responses: RouteConfig['responses'] = {
      [doc.response.status]: doc.response.schema
        ? { description: doc.response.description, content: { 'application/json': { schema: doc.response.schema } } }
        : { description: doc.response.description },
    };
    const errors: number[] = [...(doc.errors ?? []), ...(doc.public ? [] : [401, 403])];
    for (const status of errors) {
      responses[status] = { description: ERROR_DESCRIPTIONS[status] ?? 'Fehler', content: { 'application/json': { schema: ApiErrorSchema } } };
    }
    const request: NonNullable<RouteConfig['request']> = {};
    if (doc.params) request.params = doc.params;
    if (doc.query) request.query = doc.query;
    if (doc.body) request.body = { content: { 'application/json': { schema: doc.body } } };
    this.registry.registerPath({
      method: doc.method,
      path: doc.path,
      summary: doc.summary,
      tags: doc.tags,
      request,
      responses,
      security: doc.public ? [] : [{ bearer: [] }, { session: [] }],
    });
  }

  generate(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
    return new OpenApiGeneratorV31(this.registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: {
        title: 'WMS API',
        version: '0.1.0',
        description: `Profil: ${this.config.profile}`,
      },
    });
  }
}
