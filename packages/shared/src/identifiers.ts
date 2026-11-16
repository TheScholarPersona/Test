import { z } from 'zod';

/**
 * Fachliche Kennungen als Branded Types.
 *
 * TypeScript typisiert strukturell: Ohne Brand wären Barcode, ERP-Code und
 * Lagerplatz-Kennung alle `string` und beliebig vertauschbar. Die Schemas
 * prüfen das Format zur Laufzeit und liefern den passenden Brand-Typ.
 */

/** Barcode einer Transporteinheit (fachlicher Schlüssel). */
export const BarcodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'Barcode darf nur Buchstaben, Ziffern und . _ - / enthalten')
  .brand<'Barcode'>();
export type Barcode = z.infer<typeof BarcodeSchema>;

/** Platzkennung im ERP-System. */
export const ErpCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .brand<'ErpCode'>();
export type ErpCode = z.infer<typeof ErpCodeSchema>;

/**
 * Koordinate eines Lagerplatzes: Bereich/Gasse/X/Y/Z,
 * z. B. `HL01/0001/0003/0002/0000`.
 */
export const LocationIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Z0-9_]{1,10}(\/[A-Z0-9_]{1,10}){4}$/,
    'Lagerplatz-Kennung muss das Format BEREICH/GASSE/X/Y/Z haben (je 1–10 Zeichen A–Z, 0–9, _)',
  )
  .brand<'LocationId'>();
export type LocationId = z.infer<typeof LocationIdSchema>;

export const barcode = (value: string): Barcode => BarcodeSchema.parse(value);
export const erpCode = (value: string): ErpCode => ErpCodeSchema.parse(value);
export const locationId = (value: string): LocationId => LocationIdSchema.parse(value);
