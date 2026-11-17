import { describe, expect, it } from 'vitest';

/**
 * Führt alle in Node-RED registrierten Szenarien aus.
 *
 * Voraussetzung: laufende Umgebung (`pnpm stack:up`). Die Adresse von
 * Node-RED kommt aus NODE_RED_URL (Standard http://localhost:1880).
 * Ist Node-RED nicht erreichbar, schlägt der Lauf fehl – er wird bewusst
 * nicht übersprungen, damit eine fehlende Umgebung in der CI auffällt.
 */

interface ScenarioInfo {
  id: string;
  description: string;
}

interface ScenarioStep {
  name: string;
  passed: boolean | null;
  detail?: string;
}

interface ScenarioResult {
  scenario: string;
  runId?: string;
  passed: boolean;
  durationMs?: number;
  steps?: ScenarioStep[];
  error?: string;
}

const baseUrl = (process.env['NODE_RED_URL'] ?? 'http://localhost:1880').replace(/\/$/, '');

async function listScenarios(): Promise<ScenarioInfo[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/test/scenarios`);
  } catch (error) {
    throw new Error(`Node-RED unter ${baseUrl} nicht erreichbar – läuft die Umgebung (pnpm stack:up)? ${String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Szenario-Liste von ${baseUrl} lieferte HTTP ${response.status}`);
  }
  return ((await response.json()) as { scenarios: ScenarioInfo[] }).scenarios;
}

function describeFailure(result: ScenarioResult): string {
  const steps = (result.steps ?? [])
    .map((step) => `  ${step.passed === true ? '✓' : '✗'} ${step.name}${step.detail ? ` – ${step.detail}` : ''}`)
    .join('\n');
  return `Szenario ${result.scenario} (Lauf ${result.runId ?? '?'}) fehlgeschlagen: ${result.error ?? 'ohne Fehlermeldung'}\n${steps}`;
}

const scenarios = await listScenarios();

describe('Node-RED-Szenarien', () => {
  it('Node-RED stellt mindestens ein Szenario bereit', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it.each(scenarios.map((s) => [s.id, s.description] as const))('%s – %s', async (id) => {
    const response = await fetch(`${baseUrl}/test/scenarios/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as ScenarioResult;
    expect(result.passed, describeFailure(result)).toBe(true);
  });

  it('meldet unbekannte Szenarien mit HTTP 404', async () => {
    const response = await fetch(`${baseUrl}/test/scenarios/gibt-es-nicht/run`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
