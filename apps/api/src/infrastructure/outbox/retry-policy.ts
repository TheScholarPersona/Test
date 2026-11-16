/** Wartezeit bis zum nächsten Versuch: 1 s, 2 s, 4 s, … höchstens 60 s. */
export function retryDelayMs(attempts: number): number {
  const base = 1000;
  const max = 60_000;
  if (attempts < 1) {
    return base;
  }
  return Math.min(max, base * 2 ** Math.min(attempts - 1, 16));
}

/** Bricht ein Promise nach `ms` Millisekunden mit einem Fehler ab. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
