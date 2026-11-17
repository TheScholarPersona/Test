import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { TransportUnitErrorReportedEvent, TransportUnitErrorResolvedEvent } from '@wms/shared';
import { ConflictError, NotFoundError } from '../../../common/domain-error.js';
import { requestContext } from '../../../common/request-context.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import type { Location } from '../../layout/index.js';
import { TransportUnitError } from '../entities/transport-unit-error.entity.js';
import type { TransportUnit } from '../entities/transport-unit.entity.js';
import type { ReportUnitError, ResolveUnitError, UnitErrorDto, UnitErrorQuery } from '../http/schemas.js';
import { TransportUnitService } from './transport-unit.service.js';

/**
 * Fehlermeldungen an Transporteinheiten: melden (Bediener, Leitstand, Anlage), abfragen, erledigen.
 * Eine Meldung ändert weder Zustand noch Platz der TU; wer sperren will, setzt zusätzlich den Zustand.
 */
@Injectable()
export class UnitErrorService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly units: TransportUnitService,
  ) {}

  report(barcode: string, input: ReportUnitError): Promise<TransportUnitError> {
    return this.em.transactional(async (tx) => this.reportIn(tx, await this.units.loadIn(tx, barcode), input, actor()));
  }

  /** Innerhalb einer bestehenden Transaktion, z. B. Störungsmeldung einer Anlage (`reportedBy: device:SPS1`). */
  reportIn(tx: EntityManager, unit: TransportUnit, input: ReportUnitError, reportedBy: string | null): TransportUnitError {
    const error = tx.create(TransportUnitError, {
      id: randomUUID(),
      unit,
      barcode: unit.barcode,
      code: input.code,
      message: input.message ?? null,
      locationId: (unit.location as Location).locationId,
      reportedBy,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    });
    this.outbox.record(tx, TransportUnitErrorReportedEvent, snapshot(error));
    return error;
  }

  resolve(barcode: string, errorId: string, input: ResolveUnitError): Promise<TransportUnitError> {
    return this.em.transactional(async (tx) => {
      const error = await tx.findOne(TransportUnitError, { id: errorId, barcode });
      if (!error) throw new NotFoundError('UNIT_ERROR_NOT_FOUND', `Fehlermeldung ${errorId} an TU ${barcode} gibt es nicht`, { barcode, errorId });
      if (error.resolvedAt) throw new ConflictError('UNIT_ERROR_RESOLVED', `Fehlermeldung ${errorId} ist bereits erledigt`, { barcode, errorId });
      error.resolvedAt = new Date();
      error.resolvedBy = actor();
      error.resolution = input.resolution ?? null;
      this.outbox.record(tx, TransportUnitErrorResolvedEvent, { ...snapshot(error), resolvedBy: error.resolvedBy, resolution: error.resolution });
      return error;
    });
  }

  /** Fehlermeldungen einer TU (Historie, neueste zuerst). Die TU muss existieren. */
  async listFor(barcode: string, state: UnitErrorQuery['state']): Promise<TransportUnitError[]> {
    await this.units.get(barcode);
    return this.em.find(TransportUnitError, { barcode, ...stateFilter(state) }, { orderBy: { reportedAt: 'desc', id: 'asc' } });
  }

  /** Arbeitsliste für den Leitstand: standardmäßig alle offenen Meldungen, älteste zuerst. */
  async list(query: UnitErrorQuery): Promise<{ items: TransportUnitError[]; total: number }> {
    const where: FilterQuery<TransportUnitError> = { ...stateFilter(query.state), ...(query.barcode ? { barcode: query.barcode } : {}) };
    const [items, total] = await this.em.findAndCount(TransportUnitError, where, { orderBy: { reportedAt: 'asc', id: 'asc' }, limit: query.limit, offset: query.offset });
    return { items, total };
  }
}

const actor = (): string | null => requestContext.get()?.actor ?? null;

function stateFilter(state: UnitErrorQuery['state']): { resolvedAt?: null | { $ne: null } } {
  if (state === 'open') return { resolvedAt: null };
  if (state === 'resolved') return { resolvedAt: { $ne: null } };
  return {};
}

function snapshot(error: TransportUnitError) {
  return { id: error.id, barcode: error.barcode, code: error.code, message: error.message ?? null, locationId: error.locationId ?? null, reportedBy: error.reportedBy ?? null };
}

export function toUnitErrorDto(error: TransportUnitError): UnitErrorDto {
  return {
    ...snapshot(error),
    reportedAt: error.reportedAt.toISOString(),
    resolvedAt: error.resolvedAt?.toISOString() ?? null,
    resolvedBy: error.resolvedBy ?? null,
    resolution: error.resolution ?? null,
  };
}
