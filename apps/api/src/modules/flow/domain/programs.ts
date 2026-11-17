import { LocationGroupNameSchema, TransportOrderPrioritySchema, TransportUnitTypeCodeSchema, type DeviceEventType } from '@wms/shared';
import { z } from 'zod';
import { LocationReferenceSchema } from '../../layout/index.js';

/**
 * Eingebaute Programme der Action-Matrix. Statt fünf Freitextfeldern
 * (OpenWMS `flexField1–5`) hat jedes Programm ein eigenes Parameter-Schema,
 * das beim Anlegen der Action geprüft wird.
 */
export const PROGRAMS = {
  'route-next': {
    description: 'TU auf den gemeldeten Platz buchen; am Ziel Auftrag abschließen, sonst nächsten Schritt der Route senden',
    events: ['request', 'arrived'],
    params: z.strictObject({}),
  },
  'create-order': {
    description: 'Identifikationspunkt: unbekannte TU anlegen (typeCode), Transportauftrag zum Ziel anlegen und ersten Schritt senden',
    events: ['request'],
    params: z.strictObject({
      target: z.union([z.strictObject({ location: LocationReferenceSchema }), z.strictObject({ group: LocationGroupNameSchema })]),
      typeCode: TransportUnitTypeCodeSchema.optional().meta({ description: 'TU-Typ, falls die TU noch nicht existiert' }),
      priority: TransportOrderPrioritySchema.default('NORMAL'),
    }),
  },
  'send-to': {
    description: 'TU buchen und fest an einen Platz schicken (z. B. Klärplatz)',
    events: ['request'],
    params: z.strictObject({ location: LocationReferenceSchema }),
  },
  book: {
    description: 'TU nur auf den gemeldeten Platz buchen',
    events: ['request', 'arrived'],
    params: z.strictObject({}),
  },
  'finish-order': {
    description: 'TU buchen und den laufenden Transportauftrag abschließen',
    events: ['request', 'arrived'],
    params: z.strictObject({}),
  },
  'lock-location': {
    description: 'Platzsperren aus der Meldung übernehmen (state) oder fest setzen (params)',
    events: ['location-status', 'error'],
    params: z.strictObject({ inbound: z.boolean().optional(), outbound: z.boolean().optional() }),
  },
  'lock-group': {
    description: 'Systemstatus: Sperren für einen ganzen Bereich übernehmen (Gruppe des meldenden Platzes oder params.group)',
    events: ['location-status', 'error'],
    params: z.strictObject({ group: LocationGroupNameSchema.optional(), inbound: z.boolean().optional(), outbound: z.boolean().optional() }),
  },
  'interrupt-order': {
    description: 'Laufenden Transportauftrag der TU unterbrechen (Störung)',
    events: ['error'],
    params: z.strictObject({}),
  },
  'node-red': {
    description: 'Node-RED-Flow ausführen lassen (Event flow.program-requested); Node-RED antwortet über die API',
    events: ['request', 'arrived', 'location-status', 'error'],
    params: z.looseObject({ flow: z.string().trim().min(1).max(100) }),
  },
} as const satisfies Record<string, { description: string; events: readonly DeviceEventType[]; params: z.ZodType }>;

export type ProgramKey = keyof typeof PROGRAMS;
export const PROGRAM_KEYS = Object.keys(PROGRAMS) as [ProgramKey, ...ProgramKey[]];
export type ProgramParams<K extends ProgramKey> = z.infer<(typeof PROGRAMS)[K]['params']>;
