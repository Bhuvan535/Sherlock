import { AppError } from '../../utils/errors.js';
import { getPlanningRuleEngine } from '../../planning/engine.js';
import { buildPlanningContext } from '../../planning/context-builder.js';
import type { PlannedWorkItem, ValidationIssue, WorkItemPlan } from '../../planning/types.js';

const BLOCKING = new Set([
    'ITERATION_INVALID',
    'AREA_INVALID',
    'ASSIGNEE_INVALID',
    'STATE_INVALID',
    'DATE_ORDER',
    'DATE_INVALID',
    'EPIC_MUST_BE_ROOT',
    'TASK_ITERATION_MATCHES_STORY',
    'FEATURE_NOT_PAST_SPRINT',
    'DEPENDENCY_CIRCULAR',
    'DEPENDENCY_DATE_ORDER',
    'HIERARCHY_DATES'
]);

export async function applyPlanningGate(item: PlannedWorkItem): Promise<ValidationIssue[]> {
    const context = await buildPlanningContext();
    const plan: WorkItemPlan = { workItems: [item] };
    const result = getPlanningRuleEngine().validate(plan, context);
    const blocking = result.errors.filter(issue => BLOCKING.has(issue.ruleId));
    if (blocking.length > 0) {
        throw new AppError('INVALID_INPUT', blocking.map(issue => issue.message).join(' '), {
            hint: blocking.map(issue => issue.ruleId).join(', ')
        });
    }
    return [...result.warnings, ...result.info, ...result.errors.filter(issue => !BLOCKING.has(issue.ruleId))];
}
