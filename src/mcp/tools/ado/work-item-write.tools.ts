import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool } from '../../tool-registry.js';
import { getWriteController } from '../../../services/write/controller.js';

const CreateSchema = {
    workItemType: z
        .enum(['Epic', 'Feature', 'User Story', 'Task', 'Bug'])
        .describe('Must exist in the configured project process. Feature requires parentId of an Epic.'),
    title: z.string().describe('Required title.'),
    description: z.string().optional(),
    assignedTo: z.string().optional(),
    state: z.string().optional(),
    priority: z.number().int().optional(),
    iterationPath: z.string().optional(),
    areaPath: z.string().optional(),
    tags: z.array(z.string()).optional(),
    plannedStart: z.string().optional(),
    plannedEnd: z.string().optional(),
    actualStart: z.string().optional(),
    actualEnd: z.string().optional(),
    parentId: z.number().int().optional().describe('Required for Feature. Story under Feature, Task under Story.'),
    acceptanceCriteria: z.string().optional(),
    reproductionSteps: z.string().optional()
};

const UpdateSchema = {
    workItemId: z.number().int().describe('Existing work-item id.'),
    title: z.string().optional(),
    description: z.string().optional(),
    state: z.string().optional(),
    priority: z.number().int().optional(),
    assignedTo: z.string().optional(),
    iterationPath: z.string().optional(),
    areaPath: z.string().optional(),
    plannedStart: z.string().optional(),
    plannedEnd: z.string().optional(),
    actualStart: z.string().optional(),
    actualEnd: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    addTags: z.array(z.string()).optional(),
    removeTags: z.array(z.string()).optional(),
    replaceTags: z.array(z.string()).optional()
};

export function registerWorkItemWriteTools(server: McpServer): void {
    registerTool(server, {
        name: 'sherlock_prepare_create_work_item',
        title: 'Prepare create work item',
        description:
            'Prepares creation of an Epic, Feature, User Story, Task, or Bug and returns a preview for the user to review. Modifies nothing. Show the preview, wait for the user to explicitly approve it, then call sherlock_confirm_write. No delete and no arbitrary JSON Patch.',
        group: 'azure-devops',
        inputSchema: CreateSchema,
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare create work item',
            subject: args => (args.title ? `create:${String(args.title)}` : null),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            getWriteController().prepareCreate({
                workItemType: String(args.workItemType),
                title: String(args.title),
                description: args.description as string | undefined,
                assignedTo: args.assignedTo as string | undefined,
                state: args.state as string | undefined,
                priority: args.priority as number | undefined,
                iterationPath: args.iterationPath as string | undefined,
                areaPath: args.areaPath as string | undefined,
                tags: args.tags as string[] | undefined,
                plannedStart: args.plannedStart as string | undefined,
                plannedEnd: args.plannedEnd as string | undefined,
                actualStart: args.actualStart as string | undefined,
                actualEnd: args.actualEnd as string | undefined,
                parentId: args.parentId as number | undefined,
                acceptanceCriteria: args.acceptanceCriteria as string | undefined,
                reproductionSteps: args.reproductionSteps as string | undefined
            }),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Create prepared. Confirmation required.'
    });

    registerTool(server, {
        name: 'sherlock_prepare_update_work_item',
        title: 'Prepare work item field update',
        description:
            'Prepares an update to listed fields and tags and returns an old-to-new preview. Modifies nothing. Show the preview, wait for explicit user approval, then call sherlock_confirm_write. No arbitrary fields or JSON Patch.',
        group: 'azure-devops',
        inputSchema: UpdateSchema,
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare update work item',
            subject: args => (args.workItemId ? `work-item:${args.workItemId}` : null),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args => {
            const { workItemId, ...rest } = args;
            return getWriteController().prepareUpdate(Number(workItemId), {
                title: rest.title as string | undefined,
                description: rest.description as string | undefined,
                state: rest.state as string | undefined,
                priority: rest.priority as number | undefined,
                assignedTo: rest.assignedTo as string | undefined,
                iterationPath: rest.iterationPath as string | undefined,
                areaPath: rest.areaPath as string | undefined,
                plannedStart: rest.plannedStart as string | undefined,
                plannedEnd: rest.plannedEnd as string | undefined,
                actualStart: rest.actualStart as string | undefined,
                actualEnd: rest.actualEnd as string | undefined,
                acceptanceCriteria: rest.acceptanceCriteria as string | undefined,
                addTags: rest.addTags as string[] | undefined,
                removeTags: rest.removeTags as string[] | undefined,
                replaceTags: rest.replaceTags as string[] | undefined
            });
        },
        summarise: result => (result as { markdown?: string }).markdown ?? 'Update prepared. Confirmation required.'
    });

    registerTool(server, {
        name: 'sherlock_prepare_set_parent',
        title: 'Prepare set work-item parent',
        description:
            'Prepares a parent link (Epic→Feature→Story→Task). Prefer sherlock_prepare_relationship_change. Call sherlock_confirm_write.',
        group: 'azure-devops',
        inputSchema: {
            workItemId: z.number().int(),
            parentId: z.number().int()
        },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare set parent',
            subject: args => (args.workItemId ? `work-item:${args.workItemId}` : null),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args => getWriteController().prepareSetParent(Number(args.workItemId), Number(args.parentId)),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Parent change prepared. Confirmation required.'
    });

    registerTool(server, {
        name: 'sherlock_prepare_relationship_change',
        title: 'Prepare hierarchy or dependency change',
        description:
            'Prepares set/remove parent or add/remove predecessor. Does not accept arbitrary relation types. Call sherlock_confirm_write.',
        group: 'azure-devops',
        inputSchema: {
            action: z.enum(['set_parent', 'remove_parent', 'add_predecessor', 'remove_predecessor']),
            workItemId: z.number().int(),
            targetId: z.number().int().optional().describe('Parent or predecessor id. Required except documentation of remove_parent.')
        },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare relationship change',
            subject: args => (args.workItemId ? `work-item:${args.workItemId}` : null),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            getWriteController().prepareRelationship({
                action: args.action as 'set_parent' | 'remove_parent' | 'add_predecessor' | 'remove_predecessor',
                workItemId: Number(args.workItemId),
                targetId: args.targetId === undefined ? undefined : Number(args.targetId)
            }),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Relationship change prepared.'
    });

    registerTool(server, {
        name: 'sherlock_prepare_add_comment',
        title: 'Prepare work-item comment',
        description: 'Prepares a discussion comment. Does NOT post until sherlock_confirm_write. Not added as a side effect of analysis.',
        group: 'azure-devops',
        inputSchema: {
            workItemId: z.number().int(),
            text: z.string()
        },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare add comment',
            subject: args => (args.workItemId ? `work-item:${args.workItemId}` : null),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args => getWriteController().prepareAddComment(Number(args.workItemId), String(args.text)),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Comment prepared. Confirmation required.'
    });

    registerTool(server, {
        name: 'sherlock_get_write_status',
        title: 'Get prepared write status',
        description: 'Returns status for a WRITE- confirmation id. Does not mutate Azure DevOps.',
        group: 'azure-devops',
        inputSchema: { confirmationId: z.string() },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Get write status',
            subject: args => (args.confirmationId ? String(args.confirmationId) : null)
        },
        handler: async args => getWriteController().getStatus(String(args.confirmationId)),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Write status.'
    });

    registerTool(server, {
        name: 'sherlock_confirm_write',
        title: 'Confirm prepared Azure DevOps write',
        description:
            'Executes a prepared write that the user has explicitly approved after seeing the preview. Rejected if the preview was never shown or the confirmation expired. Replaying a successful confirmation returns the previous result without duplicating the write. Does not accept a JSON Patch body.',
        group: 'azure-devops',
        inputSchema: {
            confirmationId: z.string().describe('Confirmation ID from a prepare tool, e.g. WRITE-8F31A.')
        },
        readOnly: false,
        audit: {
            category: 'work_item_write',
            action: 'Confirm work item write',
            subject: args => (args.confirmationId ? String(args.confirmationId) : null),
            confirmationStatus: () => 'confirmed'
        },
        handler: async args => getWriteController().confirm(String(args.confirmationId)),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Write executed.'
    });

    registerTool(server, {
        name: 'sherlock_retry_write',
        title: 'Retry a failed write',
        description: 'Retries a failed or unexecuted confirmation. Successful writes are not repeated.',
        group: 'azure-devops',
        inputSchema: { confirmationId: z.string() },
        readOnly: false,
        audit: {
            category: 'work_item_write',
            action: 'Retry work item write',
            subject: args => (args.confirmationId ? String(args.confirmationId) : null),
            confirmationStatus: () => 'confirmed'
        },
        handler: async args => getWriteController().retry(String(args.confirmationId)),
        summarise: result => (result as { markdown?: string }).markdown ?? 'Write retry finished.'
    });
}
