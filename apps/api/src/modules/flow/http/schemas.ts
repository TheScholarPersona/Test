import { BarcodeSchema, DeviceEventTypeSchema, LocationGroupNameSchema, TransportUnitTypeCodeSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';
import { PROGRAM_KEYS } from '../domain/programs.js';
import { FLOW_OUTCOMES } from '../entities/flow.entities.js';

export { pageOf };

export const RouteIdSchema = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Buchstaben, Ziffern, _ . - (max. 40)');
export const ActionNameSchema = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,60}$/, 'Buchstaben, Ziffern, _ . - (max. 60)');
export const RouteIdParam = z.object({ routeId: RouteIdSchema });
export const ActionNameParam = z.object({ name: ActionNameSchema });

/** Ort einer Route: genau ein Platz oder eine Gruppe. */
export const PlaceSpecSchema = z
  .union([z.strictObject({ location: LocationReferenceSchema }), z.strictObject({ group: LocationGroupNameSchema })])
  .meta({ id: 'FlowPlace', description: 'Platz oder Gruppe (inkl. Untergruppen über die Hierarchie)' });
export type PlaceSpec = z.infer<typeof PlaceSpecSchema>;

export const RouteStepInputSchema = z.strictObject({
  from: LocationReferenceSchema,
  next: LocationReferenceSchema,
  unitType: TransportUnitTypeCodeSchema.optional().meta({ description: 'Nur für TUs dieses Typs; ohne Angabe für alle' }),
  enabled: z.boolean().default(true),
});

export const CreateRouteSchema = z
  .strictObject({
    routeId: RouteIdSchema,
    description: z.string().trim().max(255).default(''),
    source: PlaceSpecSchema,
    target: PlaceSpecSchema,
    enabled: z.boolean().default(true),
    steps: z.array(RouteStepInputSchema).max(500).default([]),
  })
  .meta({ id: 'CreateFlowRoute' });
export type CreateRoute = z.infer<typeof CreateRouteSchema>;

export const UpdateRouteSchema = z
  .strictObject({ description: z.string().trim().max(255).optional(), enabled: z.boolean().optional() })
  .meta({ id: 'UpdateFlowRoute' });
export type UpdateRoute = z.infer<typeof UpdateRouteSchema>;

export const ReplaceStepsSchema = z.strictObject({ steps: z.array(RouteStepInputSchema).max(500) }).meta({ id: 'ReplaceFlowRouteSteps' });
export type ReplaceSteps = z.infer<typeof ReplaceStepsSchema>;

const Place = z.object({ id: z.uuid(), locationId: z.string(), plcCode: z.string().nullable() });
const PlaceOrGroup = z.union([z.object({ location: Place }), z.object({ group: z.string() })]);

export const RouteDtoSchema = z
  .object({
    routeId: z.string(),
    description: z.string(),
    source: PlaceOrGroup,
    target: PlaceOrGroup,
    enabled: z.boolean(),
    steps: z.array(z.object({ pos: z.number().int(), from: Place, next: Place, unitType: z.string().nullable(), enabled: z.boolean() })),
    version: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'FlowRoute' });
export type RouteDto = z.infer<typeof RouteDtoSchema>;

export const CreateActionSchema = z
  .strictObject({
    name: ActionNameSchema,
    description: z.string().trim().max(255).default(''),
    eventType: DeviceEventTypeSchema,
    routeId: RouteIdSchema.optional().meta({ description: 'Nur auf dieser Route; ohne Angabe für jede Route (auch ohne)' }),
    place: PlaceSpecSchema.optional().meta({ description: 'Nur an diesem Platz bzw. in dieser Gruppe; ohne Angabe überall' }),
    program: z.enum(PROGRAM_KEYS),
    params: z.record(z.string(), z.unknown()).default({}).meta({ description: 'Wird gegen das Schema des Programms geprüft' }),
    enabled: z.boolean().default(true),
  })
  .meta({ id: 'CreateFlowAction' });
export type CreateAction = z.infer<typeof CreateActionSchema>;

export const UpdateActionSchema = z
  .strictObject({
    description: z.string().trim().max(255).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .meta({ id: 'UpdateFlowAction' });
export type UpdateAction = z.infer<typeof UpdateActionSchema>;

export const ActionDtoSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    eventType: DeviceEventTypeSchema,
    routeId: z.string().nullable(),
    place: PlaceOrGroup.nullable(),
    program: z.string(),
    params: z.record(z.string(), z.unknown()),
    enabled: z.boolean(),
    version: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'FlowAction' });
export type ActionDto = z.infer<typeof ActionDtoSchema>;

export const DeviceEventSchema = z
  .strictObject({
    type: DeviceEventTypeSchema.meta({ description: 'request: Zielanfrage · arrived: TU angekommen · location-status: Platzzustand · error: Störung' }),
    location: LocationReferenceSchema,
    barcode: BarcodeSchema.optional(),
    deviceId: z.string().trim().min(1).max(64).optional(),
    state: z.strictObject({ inbound: z.boolean().optional(), outbound: z.boolean().optional() }).optional().meta({ description: 'Bei location-status: gemeldete Sperren' }),
    code: z.string().trim().min(1).max(60).optional().meta({ description: 'Bei error: Fehlercode der Anlage' }),
    message: z.string().trim().min(1).max(200).optional(),
    dryRun: z.boolean().default(false).meta({ description: 'Nur entscheiden und begründen, nichts buchen oder senden' }),
  })
  .meta({ id: 'DeviceEvent' });
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

export const CommandDtoSchema = z.object({ barcode: z.string(), from: Place, to: Place }).meta({ id: 'FlowCommand' });

export const DecisionDtoSchema = z
  .object({
    id: z.uuid(),
    eventType: DeviceEventTypeSchema,
    barcode: z.string().nullable(),
    deviceId: z.string().nullable(),
    locationId: z.string(),
    orderNumber: z.string().nullable(),
    routeId: z.string().nullable(),
    action: z.string().nullable(),
    program: z.string().nullable(),
    outcome: z.enum(FLOW_OUTCOMES),
    next: z.string().nullable(),
    trace: z.array(z.string()),
    dryRun: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'FlowDecision' });
export type DecisionDto = z.infer<typeof DecisionDtoSchema>;

export const EventResultSchema = z
  .object({ decision: DecisionDtoSchema, command: CommandDtoSchema.nullable() })
  .meta({ id: 'DeviceEventResult' });

export const ManualCommandSchema = z
  .strictObject({
    barcode: BarcodeSchema,
    to: LocationReferenceSchema,
    deviceId: z.string().trim().min(1).max(64).optional(),
    reason: z.string().trim().min(1).max(200).optional().meta({ description: 'z. B. Name des Node-RED-Flows' }),
  })
  .meta({ id: 'ManualFlowCommand', description: 'Fahrbefehl von außen, z. B. Antwort eines Node-RED-Programms' });
export type ManualCommand = z.infer<typeof ManualCommandSchema>;

export const DecisionQuerySchema = z.object({
  barcode: BarcodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DecisionQuery = z.infer<typeof DecisionQuerySchema>;

export const ProgramDtoSchema = z.object({ key: z.string(), description: z.string(), events: z.array(DeviceEventTypeSchema), params: z.unknown() }).meta({ id: 'FlowProgram' });
