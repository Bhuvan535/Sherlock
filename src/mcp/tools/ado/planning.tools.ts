import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool } from '../../tool-registry.js';
import { buildPlanningContext } from '../../../planning/context-builder.js';
import { getPlanningRuleEngine } from '../../../planning/engine.js';
import { getWorkItemPlanner } from '../../../planning/planner.js';
import type { PlannedDependency, PlannedWorkItem, ValidationResult, WorkItemPlan } from '../../../planning/types.js';
import type { PlanRevisionOp as PlannerOp } from '../../../planning/planner.js';

const PlannedItemSchema = z.object({
    temporaryId: z.string(),
    type: z.string(),
    parentTemporaryId: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    assignedTo: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    iteration: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    priority: z.number().nullable().optional(),
    plannedStart: z.string().nullable().optional(),
    plannedEnd: z.string().nullable().optional(),
    actualStart: z.string().nullable().optional(),
    actualEnd: z.string().nullable().optional(),
    acceptanceCriteria: z.union([z.array(z.string()), z.string()]).nullable().optional(),
    reproductionSteps: z.string().nullable().optional(),
    existingAdoId: z.number().nullable().optional()
});

const PlanObjectSchema = z.object({
    planId: z.string().optional(),
    project: z.string().optional(),
    team: z.string().optional(),
    summary: z.string().optional(),
    assumptions: z.array(z.string()).optional(),
    workItems: z.array(PlannedItemSchema),
    dependencies: z
        .array(
            z.object({
                fromTemporaryId: z.string(),
                toTemporaryId: z.string(),
                kind: z.string().optional()
            })
        )
        .optional()
});

function summariseResult(result: ValidationResult): string {
    if (result.valid && result.warnings.length === 0) return `Plan is valid (${result.info.length} info).`;
    if (result.valid) return `Plan has no errors; ${result.warnings.length} warning(s).`;
    return `Plan is invalid: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`;
}

export function registerPlanningTools(server: McpServer): void {
    registerTool(server, {
        name: 'sherlock_plan_work',
        title: 'Propose a work-item plan',
        description:
            'Turns a requirement into a proposed Epic→Feature→Story→Task plan. Searches existing Azure DevOps work first. Always validates with the planning rule engine. Does NOT create or update Azure DevOps work items.',
        group: 'azure-devops',
        inputSchema: {
            requirement: z.string().describe('Natural-language requirement to plan.'),
            preferredAssignee: z.string().optional(),
            area: z.string().optional(),
            priority: z.number().int().optional(),
            sprintCount: z.number().int().optional(),
            forceNew: z.boolean().optional().describe('Plan new work even if an existing story looks like a duplicate.'),
            workItems: z.array(PlannedItemSchema).optional().describe('Optional LLM-proposed items. Missing fields are filled from Azure DevOps context.'),
            dependencies: z
                .array(z.object({ fromTemporaryId: z.string(), toTemporaryId: z.string(), kind: z.string().optional() }))
                .optional()
        },
        readOnly: true,
        audit: {
            category: 'analysis',
            action: 'Propose work item plan',
            subject: args => (args.requirement ? String(args.requirement).slice(0, 80) : null)
        },
        handler: async args => {
            return getWorkItemPlanner().planWork({
                requirement: String(args.requirement),
                preferredAssignee: args.preferredAssignee as string | undefined,
                area: args.area as string | undefined,
                priority: args.priority as number | undefined,
                sprintCount: args.sprintCount as number | undefined,
                forceNew: Boolean(args.forceNew),
                workItems: args.workItems as PlannedWorkItem[] | undefined,
                dependencies: args.dependencies as PlannedDependency[] | undefined
            });
        },
        summarise: result => {
            const payload = result as { plan?: { planId?: string }; validation?: { valid?: boolean } };
            return `Plan ${payload.plan?.planId ?? ''} proposed (${payload.validation?.valid ? 'valid' : 'invalid'}). Not deployed.`;
        }
    });

    registerTool(server, {
        name: 'sherlock_get_work_plan',
        title: 'Get a stored work-item plan',
        description: 'Returns a previously proposed plan owned by this user. Does not write to Azure DevOps.',
        group: 'azure-devops',
        inputSchema: {
            planId: z.string().describe('Plan id such as PLAN-A1B2C3D4.')
        },
        readOnly: true,
        audit: {
            category: 'analysis',
            action: 'Get work item plan',
            subject: args => String(args.planId ?? '')
        },
        handler: async args => getWorkItemPlanner().getPlan(String(args.planId)),
        summarise: result => `Plan ${(result as { plan?: { planId?: string } }).plan?.planId ?? ''} retrieved.`
    });

    registerTool(server, {
        name: 'sherlock_modify_work_plan',
        title: 'Revise a stored work-item plan',
        description:
            'Applies constrained edits (set field, add task, remove item, split story, accept) then revalidates the entire plan. Does not write to Azure DevOps.',
        group: 'azure-devops',
        inputSchema: {
            planId: z.string(),
            revisions: z.array(
                z.object({
                    op: z.enum(['set', 'add_task', 'remove', 'split_story', 'accept']),
                    temporaryId: z.string().optional(),
                    field: z.string().optional(),
                    value: z.union([z.string(), z.number(), z.null()]).optional(),
                    parentTemporaryId: z.string().optional(),
                    title: z.string().optional(),
                    description: z.string().optional(),
                    titles: z.array(z.string()).optional()
                })
            )
        },
        readOnly: true,
        audit: {
            category: 'analysis',
            action: 'Revise work item plan',
            subject: args => String(args.planId ?? '')
        },
        handler: async args =>
            getWorkItemPlanner().revisePlan(String(args.planId), args.revisions as PlannerOp[]),
        summarise: result => {
            const payload = result as { plan?: { planId?: string; version?: number } };
            return `Plan ${payload.plan?.planId ?? ''} revised to version ${payload.plan?.version ?? '?'}. Not deployed.`;
        }
    });

    registerTool(server, {
        name: 'sherlock_validate_work_item_plan',
        title: 'Validate work-item plan',
        description:
            'Validates a proposed Epic→Feature→Story→Task plan against S.H.E.R.L.O.C.K. planning rules. Reads Azure DevOps for members, areas, iterations, states, and existing titles. Does not create or update work items.',
        group: 'azure-devops',
        inputSchema: {
            plan: PlanObjectSchema.describe('Proposed work-item tree. Validated locally against Azure DevOps context. Does not write.')
        },
        readOnly: true,
        audit: {
            category: 'analysis',
            action: 'Validate work item plan',
            subject: args => {
                const plan = args.plan as WorkItemPlan | undefined;
                return plan?.planId ?? (plan?.workItems?.length ? `items:${plan.workItems.length}` : null);
            }
        },
        handler: async args => {
            const raw = args.plan as WorkItemPlan;
            const plan: WorkItemPlan = {
                planId: raw.planId,
                project: raw.project,
                team: raw.team,
                summary: raw.summary,
                assumptions: raw.assumptions,
                workItems: (raw.workItems ?? []) as PlannedWorkItem[],
                dependencies: (raw.dependencies ?? []) as PlannedDependency[]
            };
            const context = await buildPlanningContext();
            const result = getPlanningRuleEngine().validate(plan, context);
            return {
                ...result,
                markdown: summariseResult(result),
                deployed: false
            };
        },
        summarise: result => (result as { markdown?: string }).markdown ?? 'Plan validated.'
    });
}
