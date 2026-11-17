import 'reflect-metadata';
import { type INestApplication, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';

export interface CreateAppOptions {
  logger?: LogLevel[] | false;
}

/** Erzeugt die Anwendung; genutzt von `main.ts` und von Integrationstests. */
export async function createApp(config: AppConfig, options: CreateAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: options.logger ?? ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  return app;
}
