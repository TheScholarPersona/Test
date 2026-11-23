import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { JournalService } from '../application/journal.service.js';

const TAGS = ['Bestand'];
const Hash = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 als 64 Hex-Zeichen');
const Day = z.iso.date();

const AnchorSchema = z.object({ seq: z.number().int().min(0), hash: Hash }).meta({ id: 'JournalAnchor' });
const HeadSchema = AnchorSchema.extend({ updatedAt: z.iso.datetime() }).meta({ id: 'JournalHead' });
const DayParam = z.object({ day: Day });
const BookingIdParam = z.object({ id: z.uuid() });
const DayRootSchema = z
  .object({ day: Day, count: z.number().int(), firstSeq: z.number().int().nullable(), lastSeq: z.number().int().nullable(), root: Hash })
  .meta({ id: 'JournalDayRoot' });
const ProofSchema = z
  .object({ bookingId: z.uuid(), seq: z.number().int(), hash: Hash, day: Day, index: z.number().int(), size: z.number().int(), proof: z.array(Hash), root: Hash })
  .meta({ id: 'JournalProof' });
const VerifyInputSchema = z
  .object({ anchor: AnchorSchema.optional(), days: z.array(z.object({ day: Day, root: Hash })).max(400).optional() })
  .strict()
  .meta({ id: 'JournalVerifyInput' });
type VerifyInput = z.infer<typeof VerifyInputSchema>;
const VerificationSchema = z
  .object({
    ok: z.boolean(),
    checked: z.number().int(),
    head: AnchorSchema,
    pending: z.number().int(),
    problems: z.array(z.object({ code: z.string(), seq: z.number().int().nullable(), bookingId: z.string().nullable(), message: z.string() })),
    anchor: AnchorSchema.extend({ ok: z.boolean() }).nullable(),
    days: z.array(z.object({ day: Day, expected: Hash, actual: Hash, ok: z.boolean() })),
  })
  .meta({ id: 'JournalVerification' });

/** Hash-Kette und Merkle-Wurzeln des Buchungsjournals (Manipulationsnachweis). */
@Controller('v1')
export class JournalController {
  constructor(
    private readonly journal: JournalService,
    docs: ApiDocumentation,
  ) {
    docs.route({ method: 'get', path: '/v1/stock-journal/head', summary: 'Kopf der Hash-Kette (zum externen Verankern)', tags: TAGS, response: { status: 200, description: 'Kopf', schema: HeadSchema } });
    docs.route({ method: 'get', path: '/v1/stock-journal/days/{day}', summary: 'Merkle-Wurzel der Buchungen eines Tages (UTC)', tags: TAGS, params: DayParam, response: { status: 200, description: 'Tageswurzel', schema: DayRootSchema } });
    docs.route({ method: 'get', path: '/v1/stock-bookings/{id}/proof', summary: 'Merkle-Beweis einer Buchung', tags: TAGS, params: BookingIdParam, response: { status: 200, description: 'Beweis', schema: ProofSchema }, errors: [404] });
    docs.route({ method: 'post', path: '/v1/stock-journal/verify', summary: 'Hash-Kette vollständig prüfen, optional gegen verankerten Kopf und Tageswurzeln', tags: TAGS, body: VerifyInputSchema, response: { status: 200, description: 'Ergebnis', schema: VerificationSchema }, errors: [400] });
  }

  @Get('stock-journal/head')
  head() {
    return this.journal.head();
  }

  @Get('stock-journal/days/:day')
  day(@Param(new ZodValidationPipe(DayParam)) { day }: z.infer<typeof DayParam>) {
    return this.journal.day(day);
  }

  @Get('stock-bookings/:id/proof')
  proof(@Param(new ZodValidationPipe(BookingIdParam)) { id }: z.infer<typeof BookingIdParam>) {
    return this.journal.proof(id);
  }

  @Post('stock-journal/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body(new ZodValidationPipe(VerifyInputSchema)) input: VerifyInput) {
    return this.journal.verify(input);
  }
}
