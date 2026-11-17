/**
 * Bremse gegen Passwortraten: nach `maxFailures` Fehlversuchen für dieselbe
 * Kombination aus Adresse und Benutzername innerhalb von `windowMs` wird
 * `lockMs` lang abgelehnt. Im Speicher je API-Instanz – genügt gegen
 * Durchprobieren, ersetzt aber keinen vorgeschalteten Schutz (Proxy/WAF).
 */
export class LoginThrottle {
  private readonly attempts = new Map<string, { failures: number[]; lockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Restsperre in Millisekunden, 0 = frei. */
  lockedFor(key: string): number {
    const entry = this.attempts.get(key);
    return entry ? Math.max(0, entry.lockedUntil - this.now()) : 0;
  }

  failure(key: string): void {
    const t = this.now();
    const entry = this.attempts.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = [...entry.failures.filter((f) => t - f < this.windowMs), t];
    if (entry.failures.length >= this.maxFailures) {
      entry.lockedUntil = t + this.lockMs;
      entry.failures = [];
    }
    this.attempts.set(key, entry);
    if (this.attempts.size > 10_000) this.attempts.delete(this.attempts.keys().next().value!);
  }

  success(key: string): void {
    this.attempts.delete(key);
  }
}
