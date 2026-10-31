import { randomBytes } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { getWorkItemPlanRepository, type WorkItemPlanRepository } from '../database/repository/work-item-plan.repository.js';
import { getWriteApprovalRepository } from '../database/repository/write-approval.repository.js';
import { buildPlanningContext } from './context-builder.js';
import { capabilityTitle, featureTitles, storyThemes, wantsMultipleSprints } from './decompose.js';
import { getPlanningRuleEngine, type PlanningRuleEngine } from './engine.js';
import { diffPlans, formatPlanDiff, formatPlanMarkdown } from './plan-formatter.js';
import { pickSprintWindow, sprintDateRange } from './plan-dates.js';
import { findExistingMatches, strongestMatch } from './search-existing.js';
import type {
    ExistingMatch,
    PlannedDependency,
    PlannedWorkItem,
    PlanningContext,
    PlanStatus,
    ValidationResult,
    WorkItemPlan
} from './types.js';

const PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PlanWorkInput {
    requirement: string;
    preferredAssignee?: string;
    area?: string;
    priority?: number;
    sprintCount?: number;
    forceNew?: boolean;
    workItems?: PlannedWorkItem[];
    dependencies?: PlannedDependency[];
}

export interface PlanRevisionOp {
    op: 'set' | 'add_task' | 'remove' | 'split_story' | 'accept';
    temporaryId?: string;
    field?: string;
    value?: string | number | null;
    parentTemporaryId?: string;
    title?: string;
    description?: string;
    titles?: string[];
}

export interface PlannerResult {
    plan: WorkItemPlan;
    validation: ValidationResult;
    markdown: string;
    changes?: string;
    deployed: false;
}

export class WorkItemPlanner {
    constructor(
        private readonly engine: PlanningRuleEngine = getPlanningRuleEngine(),
        private readonly repo: WorkItemPlanRepository = getWorkItemPlanRepository(),
        private readonly loadContext: () => Promise<PlanningContext> = () => buildPlanningContext()
    ) {}

    async planWork(input: PlanWorkInput): Promise<PlannerResult> {
        const requirement = input.requirement?.trim();
        if (!requirement) throw new AppError('INVALID_INPUT', 'requirement is required.');
        const context = await this.loadContext();
        const matches = findExistingMatches(requirement, context.existingWork);
        const storyHit = strongestMatch(matches, 'User Story', 0.7);
        if (storyHit && !input.forceNew) {
            const plan = this.blankPlan(
                `An existing User Story appears to cover this requirement: #${storyHit.id} ${storyHit.title}.`,
                matches,
                [
                    'No new work items were proposed. Say forceNew to plan separately, or use Phase 1 writes to extend the existing story.'
                ]
            );
            const validation = this.engine.validate(plan, context);
            validation.warnings.unshift({
                ruleId: 'DUPLICATE_POSSIBLE',
                severity: 'WARNING',
                message: `Existing User Story #${storyHit.id} "${storyHit.title}" may already cover this request.`
            });
            return this.persist(plan, validation, 1);
        }

        const plan = input.workItems?.length
            ? this.fillProvided(input, context, matches)
            : this.generate(requirement, input, context, matches);
        const validation = this.engine.validate(plan, context);
        plan.status = statusFrom(validation);
        return this.persist(plan, validation, 1);
    }

    async getPlan(planId: string): Promise<PlannerResult> {
        const stored = this.requirePlan(planId);
        return {
            plan: stored.plan,
            validation: stored.validation,
            markdown: formatPlanMarkdown(stored.plan),
            deployed: false
        };
    }

    async revisePlan(planId: string, operations: PlanRevisionOp[]): Promise<PlannerResult> {
        const stored = this.requirePlan(planId);
        if (stored.status === 'EXPIRED') {
            throw new AppError('INVALID_INPUT', 'This plan has expired. Create a new plan.');
        }
        const before = stored.plan;
        const next = structuredClone(before) as WorkItemPlan;
        applyOperations(next, operations);
        next.version = stored.version + 1;
        for (const item of next.workItems) {
            item.actualStart = null;
            item.actualEnd = null;
        }
        const context = await this.loadContext();
        const validation = this.engine.validate(next, context);
        next.status = operations.some(op => op.op === 'accept') && validation.valid ? 'ACCEPTED' : statusFrom(validation);
        const result = this.persist(next, validation, next.version, stored);
        // Any edit invalidates approvals issued for the previous version: the user
        // approved a plan that no longer exists.
        getWriteApprovalRepository().supersedeForPlan(stored.planId, getConfig().userId);
        result.changes = formatPlanDiff(diffPlans(before, next));
        return result;
    }

    private requirePlan(planId: string) {
        const config = getConfig();
        const stored = this.repo.getByPlanId(planId.trim(), config.userId);
        if (!stored) {
            throw new AppError('NOT_FOUND', `Plan ${planId} was not found for this user.`);
        }
        if (new Date(stored.expiresAt).getTime() < Date.now()) {
            stored.status = 'EXPIRED';
            stored.plan.status = 'EXPIRED';
        }
        return stored;
    }

    private persist(
        plan: WorkItemPlan,
        validation: ValidationResult,
        version: number,
        previous?: ReturnType<WorkItemPlanner['requirePlan']>
    ): PlannerResult {
        const config = getConfig();
        const now = new Date();
        const planId = plan.planId ?? newPlanId();
        plan.planId = planId;
        plan.version = version;
        plan.project = plan.project ?? config.ado.project;
        plan.team = plan.team ?? config.ado.team;
        const record = {
            planId,
            userId: config.userId,
            team: plan.team,
            project: plan.project,
            version,
            status: plan.status ?? statusFrom(validation),
            plan,
            validation,
            createdAt: previous?.createdAt ?? now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString()
        };
        if (previous) this.repo.update(record);
        else this.repo.insert(record);
        return {
            plan,
            validation,
            markdown: `${formatPlanMarkdown(plan)}\n\nValidation: ${validation.valid ? 'no errors' : `${validation.errors.length} error(s)`}; ${validation.warnings.length} warning(s).`,
            deployed: false
        };
    }

    private blankPlan(summary: string, matches: ExistingMatch[], assumptions: string[]): WorkItemPlan {
        const config = getConfig();
        return {
            planId: newPlanId(),
            project: config.ado.project,
            team: config.ado.team,
            summary,
            assumptions,
            version: 1,
            status: 'DRAFT',
            workItems: [],
            dependencies: [],
            existingMatches: matches
        };
    }

    private fillProvided(input: PlanWorkInput, context: PlanningContext, matches: ExistingMatch[]): WorkItemPlan {
        const assumptions: string[] = [];
        const defaults = resolveDefaults(input, context, assumptions);
        const workItems = input.workItems!.map((item, index) =>
            applyDefaults(item, defaults, `ITEM-${index + 1}`)
        );
        return this.wrap(capabilityTitle(input.requirement), workItems, input.dependencies ?? [], assumptions, matches);
    }

    private generate(
        requirement: string,
        input: PlanWorkInput,
        context: PlanningContext,
        matches: ExistingMatch[]
    ): WorkItemPlan {
        const assumptions: string[] = [];
        const defaults = resolveDefaults(input, context, assumptions);
        const capability = capabilityTitle(requirement);
        const features = featureTitles(requirement, capability);
        const themes = storyThemes(requirement);
        const sprintCount = wantsMultipleSprints(requirement, input.sprintCount);
        const window = pickSprintWindow(context.iterations, sprintCount);
        const featureMatch = strongestMatch(matches, 'Feature', 0.5);
        const workItems: PlannedWorkItem[] = [];
        const dependencies: PlannedDependency[] = [];

        const epicId = 'EPIC-1';
        const lastSprint = window[window.length - 1] ?? window[0];
        const firstSprint = window[0];
        const epicRange =
            firstSprint && lastSprint
                ? { start: sprintDateRange(firstSprint)?.start, end: sprintDateRange(lastSprint)?.end }
                : { start: defaults.plannedStart, end: defaults.plannedEnd };
        workItems.push(
            applyDefaults(
                {
                    temporaryId: epicId,
                    type: 'Epic',
                    title: `${capability} outcome`,
                    description: requirement.trim(),
                    iteration: lastSprint?.path ?? lastSprint?.name ?? defaults.iteration,
                    plannedStart: epicRange.start,
                    plannedEnd: epicRange.end,
                    parentTemporaryId: null
                },
                defaults,
                epicId
            )
        );
        assumptions.push(
            lastSprint
                ? `Epic iteration set to end sprint ${lastSprint.name}.`
                : 'Epic iteration could not be taken from Azure DevOps sprint dates.'
        );

        const featureIds: string[] = [];

        if (featureMatch && !input.forceNew) {
            featureIds.push('FEAT-EXISTING');
            assumptions.push(`Reusing existing Feature #${featureMatch.id} "${featureMatch.title}" instead of creating a duplicate Feature.`);
            workItems.push(
                applyDefaults(
                    {
                        temporaryId: 'FEAT-EXISTING',
                        type: 'Feature',
                        title: featureMatch.title,
                        description: `Existing Feature #${featureMatch.id}. New stories below extend this capability.`,
                        existingAdoId: featureMatch.id,
                        parentTemporaryId: epicId,
                        iteration: lastSprint?.path ?? lastSprint?.name ?? defaults.iteration,
                        plannedStart: epicRange.start,
                        plannedEnd: epicRange.end
                    },
                    defaults,
                    'FEAT-EXISTING'
                )
            );
        } else {
            features.forEach((title, index) => {
                const id = `FEAT-${index + 1}`;
                featureIds.push(id);
                const delivery = window[0] ?? lastOf(window);
                const endSprint = window[window.length - 1] ?? delivery;
                workItems.push(
                    applyDefaults(
                        {
                            temporaryId: id,
                            type: 'Feature',
                            parentTemporaryId: epicId,
                            title,
                            description: `Deliver ${title} as a capability under ${capability}.`,
                            iteration: delivery?.path ?? delivery?.name ?? defaults.iteration,
                            plannedStart: delivery ? sprintDateRange(delivery)?.start ?? defaults.plannedStart : defaults.plannedStart,
                            plannedEnd: endSprint ? sprintDateRange(endSprint)?.end ?? defaults.plannedEnd : defaults.plannedEnd
                        },
                        defaults,
                        id
                    )
                );
            });
        }

        const featureId = featureIds[0]!;
        themes.forEach((theme, index) => {
            const storyId = `US-${index + 1}`;
            const sprint = window[Math.min(index, window.length - 1)] ?? window[0];
            const range = sprint ? sprintDateRange(sprint) : null;
            const storyTitle = /^user can /i.test(theme) ? theme : `User can ${theme}`;
            workItems.push(
                applyDefaults(
                    {
                        temporaryId: storyId,
                        type: 'User Story',
                        parentTemporaryId: featureId,
                        title: storyTitle,
                        description: `${storyTitle} as part of ${capability}. ${requirement.trim()}`,
                        acceptanceCriteria: testableCriteria(storyTitle),
                        iteration: sprint?.path ?? sprint?.name ?? defaults.iteration,
                        plannedStart: range?.start ?? defaults.plannedStart,
                        plannedEnd: range?.end ?? defaults.plannedEnd
                    },
                    defaults,
                    storyId
                )
            );
            const taskId = `TASK-${index + 1}`;
            workItems.push(
                applyDefaults(
                    {
                        temporaryId: taskId,
                        type: 'Task',
                        parentTemporaryId: storyId,
                        title: `Implement ${theme}`,
                        description: `Implement and verify: ${storyTitle}.`,
                        iteration: sprint?.path ?? sprint?.name ?? defaults.iteration,
                        plannedStart: range?.start ?? defaults.plannedStart,
                        plannedEnd: range?.end ?? defaults.plannedEnd
                    },
                    defaults,
                    taskId
                )
            );
        });

        if (!defaults.assignedTo) {
            assumptions.push('Assignee could not be inferred; a valid team member is required.');
        }
        if (defaults.priorityInferred) {
            assumptions.push(`Priority ${defaults.priority} inferred because none was provided.`);
        }
        if (defaults.assigneeInferred && defaults.assignedTo) {
            assumptions.push(`Assignee ${defaults.assignedTo} inferred from team membership/capacity.`);
        }
        if (window[0]) assumptions.push(`Story work placed from ${window[0].name} using Azure DevOps sprint dates.`);

        return this.wrap(`Proposed plan for: ${capability}`, workItems, dependencies, assumptions, matches);
    }

    private wrap(
        summary: string,
        workItems: PlannedWorkItem[],
        dependencies: PlannedDependency[],
        assumptions: string[],
        matches: ExistingMatch[]
    ): WorkItemPlan {
        const config = getConfig();
        return {
            planId: newPlanId(),
            project: config.ado.project,
            team: config.ado.team,
            summary,
            assumptions,
            version: 1,
            status: 'DRAFT',
            workItems,
            dependencies,
            existingMatches: matches
        };
    }
}

interface Defaults {
    assignedTo: string | null;
    area: string | null;
    iteration: string | null;
    state: string;
    priority: number;
    plannedStart: string | null;
    plannedEnd: string | null;
    priorityInferred: boolean;
    assigneeInferred: boolean;
}

function resolveDefaults(input: PlanWorkInput, context: PlanningContext, assumptions: string[]): Defaults {
    const area = input.area?.trim() || context.defaultAreaPath || context.areaPaths[0] || null;
    if (!area) assumptions.push('No Area Path was available from Azure DevOps.');
    const window = pickSprintWindow(context.iterations, wantsMultipleSprints(input.requirement, input.sprintCount));
    const first = window[0];
    const range = first ? sprintDateRange(first) : null;
    const states = context.statesByType['User Story'] ?? context.statesByType['Task'] ?? [];
    const state = states.find(s => s.toLowerCase() === 'new') ?? states[0] ?? 'New';
    let assignedTo: string | null = null;
    let assigneeInferred = false;
    if (input.preferredAssignee) {
        const needle = input.preferredAssignee.trim().toLowerCase();
        const member = context.members.find(
            m => m.displayName.toLowerCase() === needle || (m.email ?? '').toLowerCase() === needle || m.displayName.toLowerCase().includes(needle)
        );
        assignedTo = member?.displayName ?? null;
        if (!assignedTo) assumptions.push(`Preferred assignee "${input.preferredAssignee}" is not on the team.`);
    } else if (context.members.length === 1) {
        assignedTo = context.members[0]!.displayName;
        assigneeInferred = true;
    } else if (context.capacityAvailable && context.capacity && context.capacity.length > 0) {
        const ranked = [...context.capacity].sort((a, b) => b.availableDays - a.availableDays);
        assignedTo = ranked[0]?.assignee ?? null;
        assigneeInferred = Boolean(assignedTo);
    }
    const priority = input.priority && input.priority >= 1 && input.priority <= 4 ? input.priority : 2;
    return {
        assignedTo,
        area,
        iteration: first?.path ?? first?.name ?? null,
        state,
        priority,
        plannedStart: range?.start ?? null,
        plannedEnd: range?.end ?? null,
        priorityInferred: input.priority == null,
        assigneeInferred
    };
}

function applyDefaults(item: PlannedWorkItem, defaults: Defaults, fallbackId: string): PlannedWorkItem {
    return {
        ...item,
        temporaryId: item.temporaryId?.trim() || fallbackId,
        assignedTo: item.assignedTo ?? defaults.assignedTo,
        area: item.area ?? defaults.area,
        iteration: item.iteration ?? defaults.iteration,
        state: item.state ?? defaults.state,
        priority: item.priority ?? defaults.priority,
        plannedStart: item.plannedStart ?? defaults.plannedStart,
        plannedEnd: item.plannedEnd ?? defaults.plannedEnd,
        actualStart: null,
        actualEnd: null,
        description: item.description ?? item.title ?? ''
    };
}

function testableCriteria(storyTitle: string): string[] {
    return [
        `${storyTitle} succeeds for a valid user.`,
        `Invalid or missing credentials are rejected.`,
        `Failure is handled without exposing secrets.`,
        `The outcome is observable in application logs.`
    ];
}

function statusFrom(validation: ValidationResult): PlanStatus {
    return validation.valid ? 'VALID' : 'INVALID';
}

function newPlanId(): string {
    return `PLAN-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function lastOf<T>(items: T[]): T | undefined {
    return items[items.length - 1];
}

function applyOperations(plan: WorkItemPlan, operations: PlanRevisionOp[]): void {
    for (const operation of operations) {
        if (operation.op === 'accept') continue;
        if (operation.op === 'set') {
            const item = plan.workItems.find(i => i.temporaryId === operation.temporaryId);
            if (!item || !operation.field) {
                throw new AppError('INVALID_INPUT', 'set requires a known temporaryId and field.');
            }
            const field = operation.field;
            if (field === 'priority') item.priority = Number(operation.value);
            else (item as unknown as Record<string, unknown>)[field] = operation.value;
            if (field === 'iteration') syncTaskIterations(plan, item);
        }
        if (operation.op === 'add_task') {
            const parent = plan.workItems.find(i => i.temporaryId === operation.parentTemporaryId);
            if (!parent || parent.type !== 'User Story') {
                throw new AppError('INVALID_INPUT', 'add_task requires a User Story parentTemporaryId.');
            }
            const id = `TASK-${plan.workItems.length + 1}`;
            plan.workItems.push({
                temporaryId: id,
                type: 'Task',
                parentTemporaryId: parent.temporaryId,
                title: operation.title ?? 'New task',
                description: operation.description ?? operation.title ?? 'New task',
                assignedTo: parent.assignedTo,
                area: parent.area,
                iteration: parent.iteration,
                state: parent.state,
                priority: parent.priority,
                plannedStart: parent.plannedStart,
                plannedEnd: parent.plannedEnd,
                actualStart: null,
                actualEnd: null
            });
        }
        if (operation.op === 'remove') {
            const removeIds = new Set<string>();
            const visit = (id: string) => {
                removeIds.add(id);
                for (const child of plan.workItems.filter(i => i.parentTemporaryId === id)) visit(child.temporaryId);
            };
            if (!operation.temporaryId) throw new AppError('INVALID_INPUT', 'remove requires temporaryId.');
            visit(operation.temporaryId);
            plan.workItems = plan.workItems.filter(i => !removeIds.has(i.temporaryId));
        }
        if (operation.op === 'split_story') {
            splitStory(plan, operation);
        }
    }
}

function syncTaskIterations(plan: WorkItemPlan, item: PlannedWorkItem): void {
    if (item.type !== 'User Story') return;
    for (const child of plan.workItems.filter(i => i.parentTemporaryId === item.temporaryId && i.type === 'Task')) {
        child.iteration = item.iteration;
    }
}

function splitStory(plan: WorkItemPlan, operation: PlanRevisionOp): void {
    const story = plan.workItems.find(i => i.temporaryId === operation.temporaryId);
    if (!story || story.type !== 'User Story') {
        throw new AppError('INVALID_INPUT', 'split_story requires a User Story temporaryId.');
    }
    const titles = operation.titles?.filter(t => t.trim()) ?? [];
    if (titles.length !== 2) {
        throw new AppError('INVALID_INPUT', 'split_story requires exactly two titles.');
    }
    story.title = titles[0];
    story.description = titles[0];
    story.acceptanceCriteria = testableCriteria(titles[0]!);
    const newId = `US-${plan.workItems.length + 1}`;
    plan.workItems.push({
        ...story,
        temporaryId: newId,
        title: titles[1],
        description: titles[1],
        acceptanceCriteria: testableCriteria(titles[1]!)
    });
    const tasks = plan.workItems.filter(i => i.parentTemporaryId === story.temporaryId && i.type === 'Task');
    const moving = tasks.slice(Math.ceil(tasks.length / 2));
    for (const task of moving) task.parentTemporaryId = newId;
    if (moving.length === 0) {
        plan.workItems.push({
            temporaryId: `TASK-${plan.workItems.length + 1}`,
            type: 'Task',
            parentTemporaryId: newId,
            title: `Implement ${titles[1]}`,
            description: `Implement ${titles[1]}.`,
            assignedTo: story.assignedTo,
            area: story.area,
            iteration: story.iteration,
            state: story.state,
            priority: story.priority,
            plannedStart: story.plannedStart,
            plannedEnd: story.plannedEnd,
            actualStart: null,
            actualEnd: null
        });
    }
}

let shared: WorkItemPlanner | null = null;

export function getWorkItemPlanner(): WorkItemPlanner {
    shared ??= new WorkItemPlanner();
    return shared;
}

export function setWorkItemPlannerForTesting(planner: WorkItemPlanner | null): void {
    shared = planner;
}
