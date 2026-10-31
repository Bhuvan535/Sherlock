import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { getAdoClient } from '../../azure-devops/client.js';
import { getWriteOperationRepository } from '../../database/repository/write-operation.repository.js';
import { createLogger } from '../../utils/logger.js';
import { getWriteApprovalManager } from './approval.js';
import { runAuthorizedWrite } from './authorization.js';
import { getWorkItemOperationService } from './operation-service.js';
import { formatExecuteResult, formatPreparePreview } from './formatter.js';
import { WritePatchBuilder } from './patch-builder.js';
import { WriteChangePlanner } from './planner.js';
import type {
    CreateWorkItemInput,
    PlannedWrite,
    RelationshipChangeInput,
    UpdateWorkItemChanges
} from './types.js';

const log = createLogger('write-controller');

export class WriteController {
    constructor(
        private readonly planner = new WriteChangePlanner(),
        private readonly approval = getWriteApprovalManager(),
        private readonly patchBuilder = new WritePatchBuilder()
    ) {}

    async prepareCreate(input: CreateWorkItemInput) {
        return this.storePending(await this.planner.planCreate(input));
    }

    async prepareUpdate(workItemId: number, changes: UpdateWorkItemChanges) {
        return this.storePending(await this.planner.planUpdate(workItemId, changes));
    }

    async prepareSetParent(workItemId: number, parentId: number) {
        return this.storePending(await this.planner.planSetParent(workItemId, parentId));
    }

    async prepareRelationship(input: RelationshipChangeInput) {
        return this.storePending(await this.planner.planRelationship(input));
    }

    async prepareAddComment(workItemId: number, text: string) {
        return this.storePending(await this.planner.planAddComment(workItemId, text));
    }

    getStatus(confirmationId: string) {
        const pending = this.approval.get(confirmationId);
        const row = getWriteOperationRepository().getByConfirmationId(confirmationId);
        if (!pending && !row) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'Unknown confirmation ID.');
        }
        return {
            confirmationId,
            status: pending?.executed ? 'success' : row?.status ?? 'pending',
            operationType: pending?.planned.operation ?? row?.operationType,
            workItemId: pending?.planned.workItemId ?? row?.workItemId,
            executed: pending?.executed ?? row?.status === 'success',
            markdown: pending?.executed
                ? 'This write already completed. Repeating confirmation returns the previous result.'
                : `Status: ${row?.status ?? 'pending'}.`
        };
    }

    async confirm(confirmationId: string) {
        const config = getConfig();
        const pending = this.approval.claim(confirmationId, config.userId);
        if (pending.executed && pending.result) {
            return pending.result;
        }
        const repo = getWriteOperationRepository();
        const needsRev =
            pending.planned.operation !== 'CREATE_WORK_ITEM' &&
            pending.planned.operation !== 'ADD_COMMENT' &&
            pending.planned.workItemId;

        if (needsRev && pending.planned.workItemId) {
            const live = await getAdoClient().getWorkItem(config.ado.project, pending.planned.workItemId, 'none');
            if ((live.rev ?? 0) !== pending.planned.revision) {
                repo.complete(pending.confirmationId, 'conflict', null, 'WRITE_REVISION_CONFLICT');
                throw new AppError(
                    'WRITE_REVISION_CONFLICT',
                    `Work item #${pending.planned.workItemId} has changed since the update was prepared. The proposed update was not applied. Please prepare the change again.`
                );
            }
        }

        const ops = getWorkItemOperationService();
        try {
            // Everything below runs inside the approved-operation scope. The Azure
            // DevOps write client refuses to mutate outside it.
            const result = await runAuthorizedWrite(
                {
                    confirmationId: pending.confirmationId,
                    scope: 'work_item',
                    subjectId: String(pending.planned.workItemId ?? pending.planned.operation),
                    approvedAt: new Date().toISOString()
                },
                async () =>
                    pending.planned.operation === 'CREATE_WORK_ITEM'
                        ? await ops.create(pending.planned.workItemType, this.patchBuilder.build(pending.planned))
                        : pending.planned.operation === 'ADD_COMMENT'
                          ? await ops.addComment(pending.planned.workItemId!, pending.planned.commentText ?? '')
                          : await ops.update(pending.planned.workItemId!, this.patchBuilder.build(pending.planned))
            );
            const after = result.after ?? { id: result.id, url: result.url };
            let markdown = formatExecuteResult(pending.planned, after, pending.planned.revision);
            if (result.verificationMessage) markdown += `\n\n${result.verificationMessage}`;
            const payload = {
                confirmationId: pending.confirmationId,
                executed: true,
                workItemId: result.id,
                creationStatus: result.creationStatus,
                updateStatus: result.updateStatus,
                verificationStatus: result.verificationStatus,
                markdown,
                after
            };
            this.approval.markExecuted(pending.confirmationId, payload);
            repo.complete(
                pending.confirmationId,
                'success',
                JSON.stringify(after),
                result.verificationStatus === 'FAILED' ? 'VERIFICATION_ERROR' : null,
                result.id
            );
            log.info('Work item write succeeded', {
                confirmationId: pending.confirmationId,
                operation: pending.planned.operation,
                workItemId: result.id,
                verificationStatus: result.verificationStatus
            });
            return payload;
        } catch (error) {
            const app = error instanceof AppError ? error : new AppError('WRITE_FAILED', 'The Azure DevOps write failed.');
            repo.complete(pending.confirmationId, 'failed', null, app.code);
            throw app;
        }
    }

    async retry(confirmationId: string) {
        const row = getWriteOperationRepository().getByConfirmationId(confirmationId);
        if (row?.status === 'success') {
            return this.confirm(confirmationId);
        }
        return this.confirm(confirmationId);
    }

    private storePending(planned: PlannedWrite) {
        const config = getConfig();
        const pending = this.approval.create(config.userId, planned);
        getWriteOperationRepository().insert({
            requestId: pending.requestId,
            confirmationId: pending.confirmationId,
            userId: pending.userId,
            operationType: planned.operation,
            workItemId: planned.workItemId,
            workItemType: planned.workItemType,
            status: 'pending',
            beforeData: JSON.stringify(planned.snapshot),
            requestedChanges: JSON.stringify({
                changes: planned.changes,
                addTags: planned.addTags,
                removeTags: planned.removeTags,
                parentId: planned.parentId ?? null,
                relatedWorkItemId: planned.relatedWorkItemId ?? null
            }),
            afterData: null,
            errorCode: null,
            createdAt: new Date().toISOString(),
            completedAt: null
        });
        return {
            confirmationId: pending.confirmationId,
            requestId: pending.requestId,
            executed: false,
            markdown: formatPreparePreview(planned, pending.confirmationId),
            planned
        };
    }
}

let shared: WriteController | null = null;

export function getWriteController(): WriteController {
    shared ??= new WriteController();
    return shared;
}

export function resetWriteController(): void {
    shared = null;
}
