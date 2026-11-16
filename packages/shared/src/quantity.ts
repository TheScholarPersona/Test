import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Menge mit Einheit auf Basis von Dezimalarithmetik.
 *
 * Mengen und Gewichte werden nie als `number` gerechnet: 0.1 + 0.2 ergibt
 * dort 0.30000000000000004. Eingaben sind deshalb nur als Dezimal-String
 * erlaubt; in der Datenbank entspricht das dem Typ NUMERIC.
 */

export const UnitCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'Einheit muss aus 1–10 Großbuchstaben, Ziffern oder _ bestehen, z. B. PCS oder KG')
  .brand<'UnitCode'>();
export type UnitCode = z.infer<typeof UnitCodeSchema>;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export const QuantitySchema = z.object({
  amount: z.string().regex(DECIMAL_PATTERN, 'Menge muss ein Dezimal-String sein, z. B. "12.5"'),
  unit: UnitCodeSchema,
});
export type QuantityDto = z.infer<typeof QuantitySchema>;

export class QuantityUnitMismatchError extends Error {
  constructor(left: UnitCode, right: UnitCode) {
    super(`Mengen mit unterschiedlichen Einheiten [${left}] und [${right}] können nicht verrechnet werden`);
    this.name = 'QuantityUnitMismatchError';
  }
}

export class Quantity {
  private constructor(
    private readonly value: Decimal,
    readonly unit: UnitCode,
  ) {}

  static of(amount: string, unit: string): Quantity {
    const dto = QuantitySchema.parse({ amount, unit });
    return new Quantity(new Decimal(dto.amount), dto.unit);
  }

  static zero(unit: string): Quantity {
    return Quantity.of('0', unit);
  }

  static fromDto(dto: QuantityDto): Quantity {
    return Quantity.of(dto.amount, dto.unit);
  }

  get amount(): string {
    return this.value.toFixed();
  }

  add(other: Quantity): Quantity {
    this.assertSameUnit(other);
    return new Quantity(this.value.plus(other.value), this.unit);
  }

  subtract(other: Quantity): Quantity {
    this.assertSameUnit(other);
    return new Quantity(this.value.minus(other.value), this.unit);
  }

  /** -1, 0 oder 1 */
  compareTo(other: Quantity): -1 | 0 | 1 {
    this.assertSameUnit(other);
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  equals(other: Quantity): boolean {
    return this.unit === other.unit && this.value.equals(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  toDto(): QuantityDto {
    return { amount: this.amount, unit: this.unit };
  }

  toJSON(): QuantityDto {
    return this.toDto();
  }

  toString(): string {
    return `${this.amount} ${this.unit}`;
  }

  private assertSameUnit(other: Quantity): void {
    if (this.unit !== other.unit) {
      throw new QuantityUnitMismatchError(this.unit, other.unit);
    }
  }
}
