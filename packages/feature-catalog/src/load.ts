/** Lädt und validiert die Katalogdaten aus /catalog. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import { type Feature, FeatureFile, type Gap, GapFile, type ReviewItem, ReviewFile, Taxonomy } from './schema.ts';

export interface CatalogData {
  taxonomy: Taxonomy;
  /** Features mit der Datei, aus der sie stammen. */
  features: (Feature & { area: string; file: string })[];
  review: (ReviewItem & { file: string })[];
  /** Lücken gegenüber Vergleichssystemen (catalog/comparisons/<system>.yaml). */
  gaps: (Gap & { system: string; file: string })[];
}

export class CatalogLoadError extends Error {}

function load<T extends z.ZodType>(dir: string, file: string, schema: T): z.infer<T> {
  const path = join(dir, file);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CatalogLoadError(`${file}: kein gültiges YAML – ${(error as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(Wurzel)'}: ${i.message}`).join('\n');
    throw new CatalogLoadError(`${file}: entspricht nicht dem Datenmodell\n${issues}`);
  }
  return result.data;
}

export function loadCatalog(dir: string): CatalogData {
  const taxonomy = load(dir, 'catalog.yaml', Taxonomy);
  const features: CatalogData['features'] = [];
  const featureDir = join(dir, 'features');
  for (const name of existsSync(featureDir) ? readdirSync(featureDir).filter((f) => f.endsWith('.yaml')).sort() : []) {
    const file = `features/${name}`;
    const data = load(dir, file, FeatureFile);
    for (const feature of data.features) features.push({ ...feature, area: data.area, file });
  }
  const review = existsSync(join(dir, 'review.yaml')) ? load(dir, 'review.yaml', ReviewFile).items.map((i) => ({ ...i, file: 'review.yaml' })) : [];
  const gaps: CatalogData['gaps'] = [];
  const gapDir = join(dir, 'comparisons');
  for (const name of existsSync(gapDir) ? readdirSync(gapDir).filter((f) => f.endsWith('.yaml')).sort() : []) {
    const file = `comparisons/${name}`;
    const data = load(dir, file, GapFile);
    for (const gap of data.gaps) gaps.push({ ...gap, system: data.system, file });
  }
  return { taxonomy, features, review, gaps };
}
