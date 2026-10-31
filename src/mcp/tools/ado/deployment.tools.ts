import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool } from '../../tool-registry.js';
import { getDeploymentEngine } from '../../../services/deploy/engine.js';

export function registerDeploymentTools(server: McpServer): void {
    registerTool(server, {
        name: 'sherlock_prepare_deployment',
        title: 'Prepare plan deployment',
        description:
            'Revalidates a stored WorkItemPlan and returns the proposal the user must review, plus a confirmation ID. Creates nothing: the plan moves to AWAITING_CONFIRMATION. Show the returned plan to the user and only call sherlock_confirm_deployment once they explicitly approve it.',
        group: 'azure-devops',
        inputSchema: { planId: z.string().describe('Stored plan id from sherlock_plan_work.') },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Prepare plan deployment',
            subject: args => String(args.planId ?? ''),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args => getDeploymentEngine().prepare(String(args.planId)),
        summarise: result =>
            `Deployment ${(result as { confirmationId?: string }).confirmationId ?? ''} prepared. Not deployed.`
    });

    registerTool(server, {
        name: 'sherlock_confirm_deployment',
        title: 'Confirm plan deployment',
        description:
            'Creates Azure DevOps work items from a plan the user has explicitly approved after reviewing it. Requires the DEPLOY- confirmation ID, which is bound to the plan id, version and content hash: if the plan changed, the confirmation is rejected. Does not accept a JSON Patch. Does not delete. Cannot be reused. Do not call this until the user has approved the proposal.',
        group: 'azure-devops',
        inputSchema: {
            confirmationId: z.string().describe('Confirmation ID from sherlock_prepare_deployment.')
        },
        readOnly: false,
        audit: {
            category: 'work_item_write',
            action: 'Confirm plan deployment',
            subject: args => String(args.confirmationId ?? ''),
            confirmationStatus: () => 'confirmed'
        },
        handler: async args => getDeploymentEngine().confirm(String(args.confirmationId)),
        summarise: result => {
            const payload = result as { status?: string; createdCount?: number; failedCount?: number };
            return `Deployment ${payload.status ?? ''} (created ${payload.createdCount ?? 0}, failed ${payload.failedCount ?? 0}).`;
        }
    });

    registerTool(server, {
        name: 'sherlock_get_deployment_status',
        title: 'Get deployment status',
        description: 'Returns the status of a plan deployment, including temporary ID to Azure DevOps ID mapping. Does not write.',
        group: 'azure-devops',
        inputSchema: { deploymentId: z.string() },
        readOnly: true,
        audit: {
            category: 'work_item_write',
            action: 'Get deployment status',
            subject: args => String(args.deploymentId ?? '')
        },
        handler: async args => getDeploymentEngine().status(String(args.deploymentId)),
        summarise: result => `Deployment ${(result as { status?: string }).status ?? ''}.`
    });

    registerTool(server, {
        name: 'sherlock_retry_deployment',
        title: 'Retry failed deployment items',
        description:
            'Resumes a deployment the user already approved, creating only the work items that have not yet succeeded. Rejected if the deployment has no recorded approval or the plan changed since it was approved. Does not recreate successful items. Does not delete. Does not accept a JSON Patch.',
        group: 'azure-devops',
        inputSchema: { deploymentId: z.string() },
        readOnly: false,
        audit: {
            category: 'work_item_write',
            action: 'Retry plan deployment',
            subject: args => String(args.deploymentId ?? ''),
            confirmationStatus: () => 'confirmed'
        },
        handler: async args => getDeploymentEngine().retry(String(args.deploymentId)),
        summarise: result => {
            const payload = result as { status?: string; createdCount?: number; failedCount?: number };
            return `Retry ${payload.status ?? ''} (created ${payload.createdCount ?? 0}, failed ${payload.failedCount ?? 0}).`;
        }
    });
}
