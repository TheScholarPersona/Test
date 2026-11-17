import type { MetricsService } from './metrics.service.js';

type Req = { method: string; path: string; baseUrl?: string; route?: { path?: string } };
type Res = { statusCode: number; on(event: 'finish', listener: () => void): void };

/**
 * Express-Middleware: misst jede Anfrage. Als Route wird das Muster (`/v1/shipments/:number`) erfasst,
 * nicht der konkrete Pfad – so bleibt die Zahl der Zeitreihen klein.
 */
export function httpMetrics(metrics: MetricsService) {
  return (req: Req, res: Res, next: () => void) => {
    const stop = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : req.path.startsWith('/ui') ? '/ui' : 'unmatched';
      stop({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  };
}
