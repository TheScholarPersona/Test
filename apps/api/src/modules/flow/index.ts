/**
 * Öffentliche Schnittstelle des Materialfluss-Moduls.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { FlowAction, FlowDecision, FlowRoute, FlowRouteStep } from './entities/flow.entities.js';

export { FlowModule } from './flow.module.js';
export { FlowService } from './application/flow.service.js';

export const flowEntities = [FlowRoute, FlowRouteStep, FlowAction, FlowDecision];
