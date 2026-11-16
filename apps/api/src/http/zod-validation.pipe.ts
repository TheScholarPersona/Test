import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Prüft Eingaben an der Systemgrenze gegen ein Zod-Schema.
 * Antwort bei Fehlern: 400 mit Liste der betroffenen Felder.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'Validierungsfehler', issues });
    }
    return result.data;
  }
}
