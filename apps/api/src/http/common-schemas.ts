import { z } from 'zod';

/** Gewicht in Kilogramm, höchstens 9 Vor- und 3 Nachkommastellen (Spalte NUMERIC(12,3)). */
export const WeightKgSchema = z
  .object({
    amount: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, 'Gewicht: nicht negativ, höchstens 9 Vor- und 3 Nachkommastellen, z. B. "1250.5"'),
    unit: z.literal('KG'),
  })
  .meta({ id: 'WeightKg' });
export type WeightKg = z.infer<typeof WeightKgSchema>;

/** PostgreSQL liefert NUMERIC mit fester Nachkommazahl ("1250.500"); ohne überflüssige Nullen zurückgeben. */
export function normalizeDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function toWeightKg(value: string | null | undefined): WeightKg | null {
  return value == null ? null : { amount: normalizeDecimal(value), unit: 'KG' };
}

export const Timestamps = {
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const timestampsOf = (entity: { version: number; createdAt: Date; updatedAt: Date }) => ({
  version: entity.version,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
});

export const itemsOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
export const pageOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int() });
