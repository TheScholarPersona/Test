import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';

/**
 * Sammelt die OpenAPI-Beschreibungen aller geladenen Module.
 * Jedes Modul registriert seine Endpunkte mit denselben Zod-Schemas,
 * die es auch zur Validierung nutzt – Dokumentation und Verhalten
 * können dadurch nicht auseinanderlaufen.
 */
@Injectable()
export class ApiDocumentation {
  private readonly registry = new OpenAPIRegistry();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  registerPath(route: RouteConfig): void {
    this.registry.registerPath(route);
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
