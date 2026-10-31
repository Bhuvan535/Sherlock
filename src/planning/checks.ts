import { businessDaysBetween, startOfDay } from '../utils/dates.js';
import {
    areaAllowed,
    asText,
    blank,
    byId,
    childrenOf,
    dateOf,
    expectedEndIteration,
    isCeremonyTitle,
    isMeaninglessTitle,
    normalizeTitle,
    resolveIteration,
    resolveMember,
    statesFor,
    tokenOverlap
} from './helpers.js';
import type {
    PlannedWorkItem,
    PlanningContext,
    RuleSeverity,
    ValidationIssue,
    WorkItemPlan
} from './types.js';

const PLANNED_TYPES = new Set(['Epic', 'Feature', 'User Story', 'Task']);
const KNOWN_TYPES = new Set(['Epic', 'Feature', 'User Story', 'Task', 'Bug']);
const EXPECTED_PARENT: Record<string, string> = {
    Feature: 'Epic',
    'User Story': 'Feature',
    Task: 'User Story'
};

function issue(
    ruleId: string,
    severity: RuleSeverity,
    message: string,
    workItemId?: string
): ValidationIssue {
    return { ruleId, severity, message, workItemId };
}

export function collectPlanningIssues(plan: WorkItemPlan, context: PlanningContext): ValidationIssue[] {
    const items = plan.workItems ?? [];
    const issues: ValidationIssue[] = [];
    const index = byId(items);
    const seenIds = new Set<string>();

    for (const item of items) {
        if (!item.temporaryId || seenIds.has(item.temporaryId)) {
            issues.push(issue('TYPE_REQUIRED', 'ERROR', 'Each work item needs a unique temporaryId.', item.temporaryId));
        }
        seenIds.add(item.temporaryId);
        collectItemIssues(item, items, index, context, issues);
    }

    collectDuplicates(items, context, issues);
    collectDependencies(plan, index, issues);
    collectCapacity(items, context, issues);
    return issues;
}

function collectItemIssues(
    item: PlannedWorkItem,
    items: PlannedWorkItem[],
    index: Map<string, PlannedWorkItem>,
    context: PlanningContext,
    issues: ValidationIssue[]
): void {
    const id = item.temporaryId;

    if (blank(item.type) || !KNOWN_TYPES.has(item.type)) {
        issues.push(issue('TYPE_REQUIRED', 'ERROR', 'Work item type is required and must be Epic, Feature, User Story, Task, or Bug.', id));
        return;
    }

    if (blank(item.title)) issues.push(issue('TITLE_REQUIRED', 'ERROR', 'Title is required.', id));
    if (blank(item.description)) issues.push(issue('DESCRIPTION_REQUIRED', 'ERROR', 'Description is required.', id));
    if (blank(item.assignedTo)) {
        issues.push(issue('ASSIGNEE_REQUIRED', 'ERROR', 'Assigned To is required.', id));
    } else if (context.members.length > 0 && !resolveMember(String(item.assignedTo), context)) {
        issues.push(issue('ASSIGNEE_INVALID', 'ERROR', `Assignee "${item.assignedTo}" is not a member of the configured team.`, id));
    }
    if (blank(item.area)) {
        issues.push(issue('AREA_REQUIRED', 'ERROR', 'Area Path is required.', id));
    } else if (context.areaPaths.length > 0 && !areaAllowed(String(item.area), context)) {
        issues.push(issue('AREA_INVALID', 'ERROR', `Area Path "${item.area}" does not exist for this team.`, id));
    }
    if (blank(item.iteration)) {
        issues.push(issue('ITERATION_REQUIRED', 'ERROR', 'Iteration is required.', id));
    } else if (context.iterations.length > 0 && !resolveIteration(String(item.iteration), context)) {
        issues.push(issue('ITERATION_INVALID', 'ERROR', `Iteration "${item.iteration}" was not found. Do not invent sprint names.`, id));
    }
    if (blank(item.state)) {
        issues.push(issue('STATE_REQUIRED', 'ERROR', 'State is required.', id));
    } else {
        const allowed = statesFor(item.type, context);
        if (allowed.length > 0 && !allowed.some(s => s.toLowerCase() === String(item.state).toLowerCase())) {
            issues.push(issue('STATE_INVALID', 'ERROR', `State "${item.state}" is not valid for ${item.type}.`, id));
        }
    }
    if (item.priority == null || !Number.isInteger(item.priority) || item.priority < 1 || item.priority > 4) {
        issues.push(issue('PRIORITY_REQUIRED', 'ERROR', 'Priority is required (integer 1–4).', id));
    }

    if (PLANNED_TYPES.has(item.type)) {
        collectDates(item, context, issues);
    }

    collectHierarchy(item, items, index, issues);
    collectSprintRules(item, index, context, issues);
    collectQuality(item, items, issues);
    collectDor(item, issues);

    if (item.type === 'Bug' && blank(item.reproductionSteps)) {
        issues.push(issue('BUG_REPRO', 'ERROR', 'Bugs require reproduction steps.', id));
    }

    collectParentChildState(item, items, issues);
}

function collectDates(item: PlannedWorkItem, context: PlanningContext, issues: ValidationIssue[]): void {
    const id = item.temporaryId;
    if (blank(item.plannedStart)) issues.push(issue('PLANNED_START_REQUIRED', 'ERROR', 'Planned Start is required.', id));
    if (blank(item.plannedEnd)) issues.push(issue('PLANNED_END_REQUIRED', 'ERROR', 'Planned End is required.', id));

    const start = dateOf(item.plannedStart);
    const end = dateOf(item.plannedEnd);
    if (!blank(item.plannedStart) && !start) {
        issues.push(issue('DATE_INVALID', 'ERROR', 'Planned Start is not a valid date.', id));
    }
    if (!blank(item.plannedEnd) && !end) {
        issues.push(issue('DATE_INVALID', 'ERROR', 'Planned End is not a valid date.', id));
    }
    if (start && end && startOfDay(start) > startOfDay(end)) {
        issues.push(issue('DATE_ORDER', 'ERROR', 'Planned Start must be on or before Planned End.', id));
    }

    if (!item.existingAdoId && (!blank(item.actualStart) || !blank(item.actualEnd))) {
        issues.push(issue('ACTUAL_ON_NEW_PLAN', 'ERROR', 'Newly planned items must not have Actual Start or Actual End.', id));
    }
    for (const [label, value, rule] of [
        ['Actual Start', item.actualStart, 'ACTUAL_IN_FUTURE'],
        ['Actual End', item.actualEnd, 'ACTUAL_IN_FUTURE']
    ] as const) {
        const parsed = dateOf(value);
        if (parsed && startOfDay(parsed) > startOfDay(context.now)) {
            issues.push(issue(rule, 'ERROR', `${label} cannot be in the future.`, id));
        }
    }

    const iteration = item.iteration ? resolveIteration(item.iteration, context) : undefined;
    if ((item.type === 'User Story' || item.type === 'Task') && iteration && start && end) {
        const iStart = dateOf(iteration.startDate);
        const iEnd = dateOf(iteration.finishDate);
        if (iStart && iEnd && (startOfDay(start) < startOfDay(iStart) || startOfDay(end) > startOfDay(iEnd))) {
            issues.push(
                issue('ITERATION_DATE_FIT', 'WARNING', 'Planned dates fall outside the selected iteration window.', id)
            );
        }
    }
}

function collectHierarchy(
    item: PlannedWorkItem,
    items: PlannedWorkItem[],
    index: Map<string, PlannedWorkItem>,
    issues: ValidationIssue[]
): void {
    const id = item.temporaryId;
    const parentId = item.parentTemporaryId?.trim() || null;

    if (item.type === 'Epic') {
        if (parentId) issues.push(issue('EPIC_MUST_BE_ROOT', 'ERROR', 'Epic must not have a parent.', id));
        return;
    }

    const needed = EXPECTED_PARENT[item.type];
    if (!needed) return;

    if (!parentId) {
        issues.push(issue('PARENT_REQUIRED', 'ERROR', `${item.type} must have a parent ${needed}.`, id));
        return;
    }
    const parent = index.get(parentId);
    if (!parent) {
        issues.push(issue('PARENT_REQUIRED', 'ERROR', `Parent "${parentId}" is not in this plan.`, id));
        return;
    }
    if (parent.type !== needed) {
        issues.push(
            issue(
                'HIERARCHY_TYPE',
                'ERROR',
                `${item.type} must be parented to ${needed}, not ${parent.type}. Hierarchy is Epic→Feature→User Story→Task.`,
                id
            )
        );
    }

    const childStart = dateOf(item.plannedStart);
    const childEnd = dateOf(item.plannedEnd);
    const parentStart = dateOf(parent.plannedStart);
    const parentEnd = dateOf(parent.plannedEnd);
    if (childStart && childEnd && parentStart && parentEnd) {
        if (startOfDay(childStart) < startOfDay(parentStart) || startOfDay(childEnd) > startOfDay(parentEnd)) {
            issues.push(issue('HIERARCHY_DATES', 'ERROR', 'Child planned period must fit inside the parent planned period.', id));
        }
    }

    if (item.type === 'Feature' && childrenOf(id, items).filter(c => c.type === 'User Story').length === 0) {
        issues.push(issue('FEATURE_HAS_STORY', 'ERROR', 'Each Feature needs at least one User Story.', id));
    }
    if (item.type === 'User Story' && childrenOf(id, items).filter(c => c.type === 'Task').length === 0) {
        issues.push(issue('STORY_HAS_TASK', 'ERROR', 'Each User Story needs at least one Task.', id));
    }
}

function collectSprintRules(
    item: PlannedWorkItem,
    index: Map<string, PlannedWorkItem>,
    context: PlanningContext,
    issues: ValidationIssue[]
): void {
    const id = item.temporaryId;
    if (item.type === 'Epic' && item.iteration && item.plannedEnd) {
        const expected = expectedEndIteration(item, context);
        const actual = resolveIteration(item.iteration, context);
        if (!expected) {
            issues.push(issue('EPIC_END_SPRINT', 'ERROR', 'Epic iteration must be the sprint that contains Planned End.', id));
        } else if (actual && actual.path !== expected.path && actual.name !== expected.name) {
            issues.push(
                issue('EPIC_END_SPRINT', 'ERROR', `Epic iteration should be the end sprint "${expected.name}", not "${actual.name}".`, id)
            );
        }
    }
    if (item.type === 'Feature' && item.iteration) {
        const it = resolveIteration(item.iteration, context);
        if (it?.timeFrame === 'past') {
            issues.push(issue('FEATURE_NOT_PAST_SPRINT', 'ERROR', 'Feature iteration must not be a past sprint.', id));
        }
    }
    if (item.type === 'Task' && item.iteration && item.parentTemporaryId) {
        const parent = index.get(item.parentTemporaryId);
        if (parent?.type === 'User Story' && parent.iteration) {
            const taskIt = resolveIteration(item.iteration, context);
            const storyIt = resolveIteration(parent.iteration, context);
            const same =
                (taskIt && storyIt && taskIt.path === storyIt.path) ||
                String(item.iteration).toLowerCase() === String(parent.iteration).toLowerCase();
            if (!same) {
                issues.push(issue('TASK_ITERATION_MATCHES_STORY', 'ERROR', 'Task iteration must match its parent User Story.', id));
            }
        }
    }
}

function collectQuality(item: PlannedWorkItem, items: PlannedWorkItem[], issues: ValidationIssue[]): void {
    const id = item.temporaryId;
    const title = asText(item.title);
    if (!title) return;

    if (isMeaninglessTitle(title)) {
        issues.push(issue('MEANINGLESS_TITLE', 'ERROR', `Title "${title}" is a generic phase/status label, not real work.`, id));
    }
    if ((item.type === 'User Story' || item.type === 'Task') && /ready for release|qa\/validation|^qa$|^validation$/i.test(title)) {
        issues.push(issue('STATUS_ONLY_ITEM', 'ERROR', 'Do not create status-only or fake release items.', id));
    }
    if ((item.type === 'Task' || item.type === 'User Story') && isCeremonyTitle(title)) {
        issues.push(issue('CEREMONY_ITEM', 'WARNING', 'Ceremony or meeting placeholders should not be planned as work items.', id));
    }

    if (item.type === 'User Story' && blank(item.acceptanceCriteria)) {
        issues.push(issue('STORY_ACCEPTANCE_CRITERIA', 'ERROR', 'User Story requires acceptance criteria.', id));
    }

    const kids = childrenOf(id, items);
    if (item.type === 'Epic' && kids.filter(c => c.type === 'Feature').length > 5) {
        issues.push(issue('OVER_DECOMPOSITION', 'WARNING', 'Epic has more than 5 Features; prefer a smaller tree.', id));
    }
    if (item.type === 'Feature' && kids.filter(c => c.type === 'User Story').length > 6) {
        issues.push(issue('OVER_DECOMPOSITION', 'WARNING', 'Feature has more than 6 User Stories; consider splitting the Feature instead.', id));
    }
    if (item.type === 'User Story' && kids.filter(c => c.type === 'Task').length > 8) {
        issues.push(issue('OVER_DECOMPOSITION', 'WARNING', 'User Story has more than 8 Tasks; this may be over-decomposed.', id));
    }
}

function collectDor(item: PlannedWorkItem, issues: ValidationIssue[]): void {
    if (String(item.state ?? '').toLowerCase() !== 'active') return;
    const id = item.temporaryId;
    if (item.type === 'User Story') {
        const ready =
            !blank(item.title) &&
            !blank(item.description) &&
            !blank(item.acceptanceCriteria) &&
            Boolean(item.parentTemporaryId) &&
            !blank(item.plannedStart) &&
            !blank(item.plannedEnd) &&
            !blank(item.iteration);
        if (!ready) {
            issues.push(
                issue('DOR_STORY_ACTIVE', 'ERROR', 'Active User Story must meet Definition of Ready (title, description, AC, Feature parent, dates, iteration).', id)
            );
        }
    }
    if (item.type === 'Task') {
        const ready = Boolean(item.parentTemporaryId) && !blank(item.title) && !isMeaninglessTitle(asText(item.title)) && !blank(item.plannedEnd);
        if (!ready) {
            issues.push(issue('DOR_TASK_ACTIVE', 'ERROR', 'Active Task must have a parent Story, a meaningful title, and Planned End.', id));
        }
    }
}

function collectParentChildState(item: PlannedWorkItem, items: PlannedWorkItem[], issues: ValidationIssue[]): void {
    if (!['Epic', 'Feature', 'User Story'].includes(item.type)) return;
    const kids = childrenOf(item.temporaryId, items);
    if (kids.length === 0) return;
    const parentState = String(item.state ?? '').toLowerCase();
    if (parentState !== 'active') return;
    const childStates = kids.map(k => String(k.state ?? '').toLowerCase());
    if (childStates.every(s => s === 'new' || s === 'proposed')) {
        issues.push(issue('PARENT_CHILD_STATE', 'ERROR', 'Parent is Active but every child is still New.', item.temporaryId));
    }
    if (childStates.every(s => s === 'closed' || s === 'removed' || s === 'done')) {
        issues.push(issue('PARENT_CHILD_STATE', 'ERROR', 'Parent is Active but every child is Closed.', item.temporaryId));
    }
}

function collectDuplicates(items: PlannedWorkItem[], context: PlanningContext, issues: ValidationIssue[]): void {
    const inPlan = new Map<string, PlannedWorkItem[]>();
    for (const item of items) {
        if (blank(item.title)) continue;
        const key = `${item.type}:${normalizeTitle(asText(item.title))}`;
        const list = inPlan.get(key) ?? [];
        list.push(item);
        inPlan.set(key, list);
    }
    for (const group of inPlan.values()) {
        if (group.length < 2) continue;
        for (const item of group.slice(1)) {
            issues.push(issue('DUPLICATE_EXACT', 'ERROR', `Duplicate title in this plan: "${item.title}".`, item.temporaryId));
        }
    }

    for (const item of items) {
        if (blank(item.title) || item.existingAdoId) continue;
        const title = asText(item.title);
        const exact = context.existingWork.find(
            existing => existing.type === item.type && normalizeTitle(existing.title) === normalizeTitle(title)
        );
        if (exact) {
            issues.push(issue('DUPLICATE_EXACT', 'ERROR', `Title matches existing ${item.type} #${exact.id} "${exact.title}".`, item.temporaryId));
            continue;
        }
        const similar = context.existingWork.find(
            existing => existing.type === item.type && tokenOverlap(existing.title, title) >= 0.7
        );
        if (similar) {
            issues.push(
                issue('DUPLICATE_POSSIBLE', 'WARNING', `Possible duplicate of existing ${item.type} #${similar.id} "${similar.title}".`, item.temporaryId)
            );
        }
    }
}

function collectDependencies(
    plan: WorkItemPlan,
    index: Map<string, PlannedWorkItem>,
    issues: ValidationIssue[]
): void {
    const deps = plan.dependencies ?? [];
    const adj = new Map<string, string[]>();
    for (const dep of deps) {
        const from = dep.fromTemporaryId;
        const to = dep.toTemporaryId;
        if (!index.has(from) || !index.has(to)) {
            issues.push(
                issue(
                    'DEPENDENCY_MISSING',
                    'ERROR',
                    `Dependency ${from} → ${to} references an item that is not in this plan.`,
                    from
                )
            );
            continue;
        }
        adj.set(from, [...(adj.get(from) ?? []), to]);
        const pred = index.get(from)!;
        const succ = index.get(to)!;
        const predEnd = dateOf(pred.plannedEnd);
        const succStart = dateOf(succ.plannedStart);
        if (predEnd && succStart && startOfDay(succStart) < startOfDay(predEnd)) {
            issues.push(
                issue('DEPENDENCY_DATE_ORDER', 'ERROR', `Successor ${to} Planned Start is before predecessor ${from} Planned End.`, to)
            );
        }
        if (!dep.kind && (!predEnd || !succStart)) {
            issues.push(issue('DEPENDENCY_UNCLEAR', 'WARNING', `Dependency ${from} → ${to} has insufficient date/kind data.`, from));
        }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string, stack: string[]): void => {
        if (visiting.has(node)) {
            issues.push(issue('DEPENDENCY_CIRCULAR', 'ERROR', `Circular dependency: ${[...stack, node].join(' → ')}.`, node));
            return;
        }
        if (visited.has(node)) return;
        visiting.add(node);
        for (const next of adj.get(node) ?? []) visit(next, [...stack, node]);
        visiting.delete(node);
        visited.add(node);
    };
    for (const node of adj.keys()) visit(node, []);
}

function collectCapacity(items: PlannedWorkItem[], context: PlanningContext, issues: ValidationIssue[]): void {
    if (!context.capacityAvailable || !context.capacity) {
        issues.push(
            issue('CAPACITY_UNAVAILABLE', 'WARNING', 'Capacity could not be verified because capacity data is unavailable.')
        );
        return;
    }
    const load = new Map<string, number>();
    for (const item of items) {
        if (item.type !== 'Task' && item.type !== 'User Story') continue;
        if (blank(item.assignedTo)) continue;
        const start = dateOf(item.plannedStart);
        const end = dateOf(item.plannedEnd);
        if (!start || !end) continue;
        const days = businessDaysBetween(start, end);
        const key = String(item.assignedTo).trim().toLowerCase();
        load.set(key, (load.get(key) ?? 0) + days);
    }
    for (const cap of context.capacity) {
        const key = cap.assignee.trim().toLowerCase();
        const assigned = load.get(key) ?? 0;
        if (assigned > cap.availableDays) {
            const sample = items.find(i => String(i.assignedTo).trim().toLowerCase() === key);
            issues.push(
                issue(
                    'CAPACITY_OVERLOAD',
                    'WARNING',
                    `${cap.assignee} is assigned ${assigned} business days against ${cap.availableDays} available.`,
                    sample?.temporaryId
                )
            );
        }
    }
}
