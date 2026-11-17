/**
 * Regeln für das Stapeln einer TU auf eine andere.
 */

export type StackingRule = 'STACK_ONTO_SELF' | 'STACK_CYCLE' | 'STACK_DIFFERENT_LOCATION' | 'STACKING_NOT_ALLOWED' | 'STACK_FULL' | 'ALREADY_STACKED';

export interface StackingViolation {
  rule: StackingRule;
  message: string;
}

export interface StackingInput {
  child: { barcode: string; typeCode: string; locationId: string; parentBarcode: string | null };
  parent: { barcode: string; typeCode: string; locationId: string; childCount: number };
  /** Barcodes oberhalb von `parent` bis zur Basis des Stapels (Eltern, Großeltern, …). */
  parentAncestors: readonly string[];
  /** Stapelregel für (Typ der Basis → Typ der aufgesetzten TU), sonst `null`. */
  rule: { maxCount: number } | null;
}

export function checkStacking(input: StackingInput): StackingViolation[] {
  const { child, parent, parentAncestors, rule } = input;
  if (child.barcode === parent.barcode) {
    return [{ rule: 'STACK_ONTO_SELF', message: 'Eine TU kann nicht auf sich selbst gestapelt werden' }];
  }
  const violations: StackingViolation[] = [];
  if (child.parentBarcode !== null) {
    violations.push({ rule: 'ALREADY_STACKED', message: `TU ${child.barcode} steht bereits auf ${child.parentBarcode}` });
  }
  if (parentAncestors.includes(child.barcode)) {
    violations.push({ rule: 'STACK_CYCLE', message: `TU ${parent.barcode} steht bereits (mittelbar) auf ${child.barcode}` });
  }
  if (child.locationId !== parent.locationId) {
    violations.push({
      rule: 'STACK_DIFFERENT_LOCATION',
      message: `TU ${child.barcode} steht auf ${child.locationId}, TU ${parent.barcode} auf ${parent.locationId}`,
    });
  }
  if (!rule) {
    violations.push({
      rule: 'STACKING_NOT_ALLOWED',
      message: `Auf TU-Typ ${parent.typeCode} darf kein ${child.typeCode} gestapelt werden`,
    });
  } else if (parent.childCount + 1 > rule.maxCount) {
    violations.push({
      rule: 'STACK_FULL',
      message: `Auf ${parent.barcode} stehen bereits ${parent.childCount} TUs, erlaubt sind ${rule.maxCount}`,
    });
  }
  return violations;
}
