import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { type Address, PartnerChangedEvent, PartnerCreatedEvent, type PartnerRole } from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { Partner } from '../entities/partner.entity.js';
import type { AddressInput, ChangePartner, CreatePartner, PartnerQuery } from '../http/schemas.js';

const ROLE_FIELD = { CUSTOMER: 'customer', SUPPLIER: 'supplier', CARRIER: 'carrier' } as const satisfies Record<PartnerRole, keyof Partner>;
const ROLE_TEXT: Record<PartnerRole, string> = { CUSTOMER: 'Kunde', SUPPLIER: 'Lieferant', CARRIER: 'Spediteur' };

export function rolesOf(partner: Partner): PartnerRole[] {
  return (Object.keys(ROLE_FIELD) as PartnerRole[]).filter((r) => partner[ROLE_FIELD[r]]);
}

export function addressOf(partner: Partner): Address {
  return { street: partner.street ?? null, postalCode: partner.postalCode ?? null, city: partner.city ?? null, country: partner.country ?? null };
}

function snapshot(partner: Partner) {
  return { code: partner.code, name: partner.name, roles: rolesOf(partner), address: addressOf(partner), active: partner.active };
}

function applyAddress(partner: Partner, address: AddressInput | undefined, changed: string[]): void {
  if (!address) return;
  for (const key of ['street', 'postalCode', 'city', 'country'] as const) {
    const value = address[key];
    if (value === undefined || value === (partner[key] ?? null)) continue;
    partner[key] = value;
    changed.push(`address.${key}`);
  }
}

/** Geschäftspartner-Stammdaten: Kunden, Lieferanten und Spediteure mit Anschrift. */
@Injectable()
export class PartnerService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
  ) {}

  create(input: CreatePartner): Promise<Partner> {
    return this.em.transactional(async (tx) => {
      if (await tx.count(Partner, { code: input.code })) throw new ConflictError('PARTNER_EXISTS', `Partner ${input.code} gibt es schon`, { code: input.code });
      const roles = new Set(input.roles);
      const partner = tx.create(Partner, {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        customer: roles.has('CUSTOMER'),
        supplier: roles.has('SUPPLIER'),
        carrier: roles.has('CARRIER'),
        street: input.address?.street ?? null,
        postalCode: input.address?.postalCode ?? null,
        city: input.address?.city ?? null,
        country: input.address?.country ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        active: true,
      });
      this.outbox.record(tx, PartnerCreatedEvent, snapshot(partner));
      return partner;
    });
  }

  async get(code: string): Promise<Partner> {
    return this.load(this.em, code);
  }

  async list(query: PartnerQuery): Promise<{ items: Partner[]; total: number }> {
    const where: FilterQuery<Partner> = {};
    if (query.role) Object.assign(where, { [ROLE_FIELD[query.role]]: true });
    if (query.active !== undefined) where.active = query.active;
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.$or = [{ code: { $ilike: like } }, { name: { $ilike: like } }, { city: { $ilike: like } }];
    }
    const [items, total] = await this.em.findAndCount(Partner, where, { orderBy: { code: 'asc' }, limit: query.limit, offset: query.offset });
    return { items, total };
  }

  change(code: string, input: ChangePartner): Promise<Partner> {
    return this.em.transactional(async (tx) => {
      const partner = await this.load(tx, code);
      const changed: string[] = [];
      if (input.name !== undefined && input.name !== partner.name) {
        partner.name = input.name;
        changed.push('name');
      }
      if (input.roles) {
        const roles = new Set(input.roles);
        for (const role of Object.keys(ROLE_FIELD) as PartnerRole[]) {
          if (partner[ROLE_FIELD[role]] === roles.has(role)) continue;
          partner[ROLE_FIELD[role]] = roles.has(role);
          changed.push('roles');
        }
      }
      applyAddress(partner, input.address, changed);
      for (const key of ['email', 'phone', 'active'] as const) {
        const value = input[key];
        if (value === undefined || value === (partner[key] ?? null)) continue;
        (partner as Record<typeof key, unknown>)[key] = value;
        changed.push(key);
      }
      const fields = [...new Set(changed)];
      if (fields.length) this.outbox.record(tx, PartnerChangedEvent, { ...snapshot(partner), fields });
      return partner;
    });
  }

  /**
   * Aktiven Partner mit dieser Rolle holen, z. B. für einen neuen Auftrag. Inaktive Partner oder
   * Partner ohne die Rolle sind ein Regelverstoß (409), unbekannte ein 404.
   */
  async requireRole(em: EntityManager, code: string, role: PartnerRole): Promise<Partner> {
    const partner = await this.load(em, code);
    if (!partner.active) throw new RuleViolationError('PARTNER_INACTIVE', `Partner ${code} ist deaktiviert`, { code });
    if (!partner[ROLE_FIELD[role]]) throw new RuleViolationError('PARTNER_ROLE_MISSING', `Partner ${code} ist kein ${ROLE_TEXT[role]}`, { code, role });
    return partner;
  }

  private async load(em: EntityManager, code: string): Promise<Partner> {
    const partner = await em.findOne(Partner, { code });
    if (!partner) throw new NotFoundError('PARTNER_NOT_FOUND', `Partner ${code} gibt es nicht`, { code });
    return partner;
  }
}
