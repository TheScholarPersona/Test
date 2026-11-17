import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from '../../src/http/zod-validation.pipe.js';

const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1), qty: z.object({ amount: z.string() }) }));

describe('ZodValidationPipe', () => {
  it('gibt geprüfte Daten zurück', () => {
    expect(pipe.transform({ name: 'A', qty: { amount: '1' }, extra: true })).toEqual({ name: 'A', qty: { amount: '1' } });
  });

  it('meldet alle fehlerhaften Felder mit Pfad', () => {
    try {
      pipe.transform({ name: '', qty: {} });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { issues: { path: string }[] };
      expect(body.issues.map((issue) => issue.path)).toEqual(['name', 'qty.amount']);
    }
  });
});
