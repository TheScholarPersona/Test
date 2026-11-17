import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { isoDate } from '../application/inventory.service.js';
import { type CountWithLines, differenceOf, StockCountService } from '../application/stock-count.service.js';
import {
  type CountDto,
  CountDtoSchema,
  CountNumberParam,
  type CountQuery,
  CountQuerySchema,
  type OpenCount,
  OpenCountSchema,
  pageOf,
  type RecordCount,
  RecordCountSchema,
} from './schemas.js';

const TAGS = ['Inventur'];
const PATH = '/v1/stock-counts';
type Q = CountDto['lines'][number]['expected'];
const q = (amount: string, unit: string) => ({ amount: normalizeDecimal(amount), unit }) as Q;

function toCountDto({ count, lines }: CountWithLines): CountDto {
  return {
    number: count.number,
    barcode: count.barcode,
    state: count.state,
    reference: count.reference ?? null,
    countedBy: count.countedBy ?? null,
    countedAt: count.countedAt?.toISOString() ?? null,
    closedAt: count.closedAt?.toISOString() ?? null,
    // Einheitliche Reihenfolge: SKU, Charge, MHD (ohne Charge zuerst).
    lines: [...lines]
      .sort(
        (a, b) =>
          a.sku.localeCompare(b.sku) ||
          (a.lot ?? '').localeCompare(b.lot ?? '') ||
          (isoDate(a.bestBefore) ?? '').localeCompare(isoDate(b.bestBefore) ?? ''),
      )
      .map((l) => {
        const diff = differenceOf(l);
        return {
          sku: l.sku,
          lot: l.lot ?? null,
          bestBefore: isoDate(l.bestBefore),
          expected: q(l.expected, l.unitCode),
          counted: l.counted == null ? null : q(l.counted, l.unitCode),
          difference: diff ? (diff.toDto() as Q) : null,
        };
      }),
    createdAt: count.createdAt.toISOString(),
  };
}

@Controller('v1/stock-counts')
export class StockCountsController {
  constructor(
    private readonly counts: StockCountService,
    docs: ApiDocumentation,
  ) {
    const one = {
      status: 200,
      description: 'Inventur',
      schema: CountDtoSchema,
    };
    const p = CountNumberParam;
    docs.route({
      method: 'get',
      path: PATH,
      summary: 'Inventuren (neueste zuerst)',
      tags: TAGS,
      query: CountQuerySchema,
      response: {
        status: 200,
        description: 'Liste',
        schema: pageOf(CountDtoSchema),
      },
    });
    docs.route({
      method: 'post',
      path: PATH,
      summary: 'Inventur einer TU öffnen (Soll festhalten, TU sperren)',
      tags: TAGS,
      body: OpenCountSchema,
      response: { ...one, status: 201 },
      errors: [400, 404, 409],
    });
    docs.route({
      method: 'get',
      path: `${PATH}/{number}`,
      summary: 'Inventur lesen',
      tags: TAGS,
      params: p,
      response: one,
      errors: [404],
    });
    docs.route({
      method: 'post',
      path: `${PATH}/{number}/result`,
      summary: 'Zählergebnis erfassen (auch erneut)',
      tags: TAGS,
      params: p,
      body: RecordCountSchema,
      response: one,
      errors: [400, 404, 409],
    });
    docs.route({
      method: 'post',
      path: `${PATH}/{number}/close`,
      summary: 'Differenzen buchen und Sperre aufheben',
      tags: TAGS,
      params: p,
      response: one,
      errors: [404, 409],
    });
    docs.route({
      method: 'post',
      path: `${PATH}/{number}/cancel`,
      summary: 'Abbrechen ohne Buchung',
      tags: TAGS,
      params: p,
      response: one,
      errors: [404, 409],
    });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(CountQuerySchema)) query: CountQuery): Promise<{ items: CountDto[]; total: number }> {
    const [items, total] = await this.counts.list(query);
    const full = await Promise.all(items.map((c) => this.counts.get(c.number)));
    return { items: full.map(toCountDto), total };
  }

  @Post()
  async open(@Body(new ZodValidationPipe(OpenCountSchema)) body: OpenCount): Promise<CountDto> {
    return toCountDto(await this.counts.open(body));
  }

  @Get(':number')
  async get(
    @Param(new ZodValidationPipe(CountNumberParam))
    { number }: { number: string },
  ): Promise<CountDto> {
    return toCountDto(await this.counts.get(number));
  }

  @Post(':number/result')
  @HttpCode(HttpStatus.OK)
  async record(
    @Param(new ZodValidationPipe(CountNumberParam))
    { number }: { number: string },
    @Body(new ZodValidationPipe(RecordCountSchema)) body: RecordCount,
  ): Promise<CountDto> {
    return toCountDto(await this.counts.record(number, body));
  }

  @Post(':number/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param(new ZodValidationPipe(CountNumberParam))
    { number }: { number: string },
  ): Promise<CountDto> {
    return toCountDto(await this.counts.close(number));
  }

  @Post(':number/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param(new ZodValidationPipe(CountNumberParam))
    { number }: { number: string },
  ): Promise<CountDto> {
    return toCountDto(await this.counts.cancel(number));
  }
}
