import { Controller, Get, Header, Param, Query, StreamableFile } from '@nestjs/common';
import { BarcodeSchema } from '@wms/shared';
import { z } from 'zod';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { DocumentService, type PdfFile } from '../application/document.service.js';

const TAGS = ['Dokumente'];
const PATH = '/v1/documents';
const PDF = 'application/pdf';

const BarcodeParam = z.object({ barcode: BarcodeSchema });
const ShipmentParam = z.object({ number: z.string().trim().min(1).max(20) });
const OrderParam = z.object({ orderId: z.string().trim().min(1).max(40) });
const LabelQuery = z.object({ unit: BarcodeSchema.optional().meta({ description: 'Nur das Etikett dieser TU' }) });

function file({ filename, content }: PdfFile): StreamableFile {
  return new StreamableFile(content, { type: PDF, disposition: `inline; filename="${filename}"`, length: content.length });
}

/** Dokumente als PDF mit internen Barcodes (Code 128). Nur lesend – jeder Angemeldete darf drucken. */
@Controller('v1/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentService,
    docs: ApiDocumentation,
  ) {
    const pdf = (description: string) => ({ status: 200, description, binary: PDF });
    docs.route({ method: 'get', path: `${PATH}/unit-label/{barcode}`, summary: 'Palettenetikett (A6): TU-Barcode, Typ, Platz, Inhalt', tags: TAGS, params: BarcodeParam, response: pdf('PDF'), errors: [404] });
    docs.route({ method: 'get', path: `${PATH}/shipping-labels/{number}`, summary: 'Versandetiketten (A6), eine Seite je TU der Sendung', tags: TAGS, params: ShipmentParam, query: LabelQuery, response: pdf('PDF'), errors: [404, 409] });
    docs.route({ method: 'get', path: `${PATH}/pick-list/{orderId}`, summary: 'Pickliste (A4): offene Picks in Platzreihenfolge', tags: TAGS, params: OrderParam, response: pdf('PDF'), errors: [404] });
    docs.route({ method: 'get', path: `${PATH}/delivery-note/{number}`, summary: 'Lieferschein (A4) einer Sendung', tags: TAGS, params: ShipmentParam, response: pdf('PDF'), errors: [404] });
    docs.route({ method: 'get', path: `${PATH}/loading-list/{number}`, summary: 'Ladeliste (A4) einer Sendung mit Kontrollfeldern', tags: TAGS, params: ShipmentParam, response: pdf('PDF'), errors: [404] });
  }

  @Get('unit-label/:barcode')
  @Header('Cache-Control', 'no-store')
  async unitLabel(@Param(new ZodValidationPipe(BarcodeParam)) { barcode }: { barcode: string }): Promise<StreamableFile> {
    return file(await this.documents.unitLabel(barcode));
  }

  @Get('shipping-labels/:number')
  @Header('Cache-Control', 'no-store')
  async shippingLabels(@Param(new ZodValidationPipe(ShipmentParam)) { number }: { number: string }, @Query(new ZodValidationPipe(LabelQuery)) query: { unit?: string | undefined }): Promise<StreamableFile> {
    return file(await this.documents.shippingLabels(number, query.unit));
  }

  @Get('pick-list/:orderId')
  @Header('Cache-Control', 'no-store')
  async pickList(@Param(new ZodValidationPipe(OrderParam)) { orderId }: { orderId: string }): Promise<StreamableFile> {
    return file(await this.documents.pickList(orderId));
  }

  @Get('delivery-note/:number')
  @Header('Cache-Control', 'no-store')
  async deliveryNote(@Param(new ZodValidationPipe(ShipmentParam)) { number }: { number: string }): Promise<StreamableFile> {
    return file(await this.documents.deliveryNote(number));
  }

  @Get('loading-list/:number')
  @Header('Cache-Control', 'no-store')
  async loadingList(@Param(new ZodValidationPipe(ShipmentParam)) { number }: { number: string }): Promise<StreamableFile> {
    return file(await this.documents.loadingList(number));
  }
}
