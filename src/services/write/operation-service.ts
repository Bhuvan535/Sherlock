import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { getAdoWriteClient } from '../../azure-devops/write-client.js';
import { getWorkItemService } from '../../azure-devops/work-item.service.js';
import { getProjectContext } from '../../azure-devops/context.js';
import { getNavigationEngine } from '../../core/navigation-engine.js';
import { sharedCache } from '../../core/cache-manager.js';
import { createLogger } from '../../utils/logger.js';
import type { JsonPatchOp } from './types.js';
import type { FieldSnapshot } from './types.js';

const log = createLogger('work-item-operations');

export interface MutationResult {
    id: number;
    rev: number | null;
    creationStatus?: 'SUCCESS';
    updateStatus?: 'SUCCESS';
    verificationStatus: 'SUCCESS' | 'FAILED';
    after: FieldSnapshot | null;
    url: string | null;
    verificationMessage: string | null;
}

export class WorkItemOperationService {
    async create(workItemType: string, operations: JsonPatchOp[]): Promise<MutationResult> {
        assertInternalPatch(operations);
        const project = getConfig().ado.project;
        const raw = await getAdoWriteClient().createWorkItem(project, workItemType, operations);
        const result = await this.verify(raw.id, raw.rev ?? null);
        this.invalidateCaches();
        return { ...result, creationStatus: 'SUCCESS' };
    }

    async update(workItemId: number, operations: JsonPatchOp[]): Promise<MutationResult> {
        assertInternalPatch(operations);
        const project = getConfig().ado.project;
        const raw = await getAdoWriteClient().updateWorkItem(project, workItemId, operations);
        const result = await this.verify(raw.id, raw.rev ?? null);
        this.invalidateCaches();
        return { ...result, updateStatus: 'SUCCESS' };
    }

    async addComment(workItemId: number, text: string): Promise<MutationResult> {
        const project = getConfig().ado.project;
        await getAdoWriteClient().addWorkItemComment(project, workItemId, text);
        const result = await this.verify(workItemId, null);
        this.invalidateCaches();
        return { ...result, updateStatus: 'SUCCESS' };
    }

    private invalidateCaches(): void {
        getProjectContext().refresh('work-items');
        sharedCache.deletePrefix('snapshot:');
        sharedCache.deletePrefix('wi:');
    }

    private async verify(id: number, rev: number | null): Promise<MutationResult> {
        const url = getNavigationEngine().getWorkItemUrl(getConfig().ado.project, id);
        try {
            const [live] = await getWorkItemService().getByIds([id]);
            if (!live) {
                log.warn('Write succeeded but verification read returned nothing', { id });
                return {
                    id,
                    rev,
                    verificationStatus: 'FAILED',
                    after: { id, url },
                    url,
                    verificationMessage: `Work item #${id} was written successfully, but S.H.E.R.L.O.C.K. could not verify its final state.`
                };
            }
            return {
                id: live.id,
                rev: live.rev,
                verificationStatus: 'SUCCESS',
                after: {
                    id: live.id,
                    rev: live.rev,
                    type: live.type,
                    title: live.title,
                    description: live.description,
                    state: live.state,
                    assignedTo: live.assignedTo,
                    url: live.webUrl ?? live.url ?? url
                },
                url: live.webUrl ?? url,
                verificationMessage: null
            };
        } catch (error) {
            log.warn('Write succeeded but verification read failed', { id, error: String(error) });
            return {
                id,
                rev,
                verificationStatus: 'FAILED',
                after: { id, url },
                url,
                verificationMessage: `Work item #${id} was written successfully, but S.H.E.R.L.O.C.K. could not verify its final state. Do not repeat the create.`
            };
        }
    }
}

let shared: WorkItemOperationService | null = null;

export function getWorkItemOperationService(): WorkItemOperationService {
    shared ??= new WorkItemOperationService();
    return shared;
}

export function resetWorkItemOperationService(): void {
    shared = null;
}

export function assertInternalPatch(operations: JsonPatchOp[]): void {
    if (!Array.isArray(operations) || operations.length === 0) {
        throw new AppError('INVALID_INPUT', 'An internal patch is required.');
    }
}
