import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type INestApplication, Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';

export interface CreateAppOptions {
  logger?: LogLevel[] | false;
}

type Req = { method: string; path: string; headers: Record<string, string | string[] | undefined> };
type Res = { sendFile(path: string): void; redirect(status: number, url: string): void };

/**
 * Liefert die gebaute Oberfläche unter `/ui/` aus (gleicher Ursprung wie
 * die API, also kein CORS). Unbekannte Pfade unter `/ui/` bekommen die
 * `index.html`, damit Seiten der Oberfläche direkt aufrufbar sind.
 */
function serveWeb(app: NestExpressApplication, dir: string): void {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    new Logger('Web').warn(`WEB_DIST_DIR ${root} enthält keine index.html – Oberfläche deaktiviert`);
    return;
  }
  app.use((req: Req, res: Res, next: () => void) => (req.method === 'GET' && req.path === '/' ? res.redirect(302, '/ui/') : next()));
  app.useStaticAssets(root, { prefix: '/ui/', index: 'index.html', maxAge: '1h' });
  app.use('/ui', (req: Req, res: Res, next: () => void) => {
    const accept = String(req.headers['accept'] ?? '');
    if (req.method === 'GET' && accept.includes('text/html')) res.sendFile(index);
    else next();
  });
  new Logger('Web').log(`Oberfläche unter /ui/ aus ${root}`);
}

/** Erzeugt die Anwendung; genutzt von `main.ts` und von Integrationstests. */
export async function createApp(config: AppConfig, options: CreateAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: options.logger ?? ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  if (config.webDistDir) serveWeb(app, config.webDistDir);
  return app;
}
