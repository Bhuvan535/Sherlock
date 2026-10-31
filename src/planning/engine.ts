import { collectPlanningIssues } from './checks.js';
import { loadRuleCatalog } from './catalog.js';
import type { PlanningContext, ValidationIssue, ValidationResult, WorkItemPlan } from './types.js';

export class PlanningRuleEngine {
    validate(plan: WorkItemPlan, context: PlanningContext): ValidationResult {
        loadRuleCatalog();
        const issues = collectPlanningIssues(plan ?? { workItems: [] }, context);
        return partition(issues);
    }
}

export function partition(issues: ValidationIssue[]): ValidationResult {
    const errors = issues.filter(i => i.severity === 'ERROR');
    const warnings = issues.filter(i => i.severity === 'WARNING');
    const info = issues.filter(i => i.severity === 'INFO');
    return { valid: errors.length === 0, errors, warnings, info };
}

let shared: PlanningRuleEngine | null = null;

export function getPlanningRuleEngine(): PlanningRuleEngine {
    shared ??= new PlanningRuleEngine();
    return shared;
}

export function setPlanningRuleEngineForTesting(engine: PlanningRuleEngine | null): void {
    shared = engine;
}
