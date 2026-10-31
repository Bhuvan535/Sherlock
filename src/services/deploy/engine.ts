import { randomBytes } from 'node:crypto';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { getNavigationEngine } from '../../core/navigation-engine.js';
import { getWorkItemOperationService } from '../write/operation-service.js';
import {
    getDeploymentRepository,
    type DeploymentItemRecord,
    type DeploymentRecord,
    type DeploymentRepository
} from '../../database/repository/deployment.repository.js';
import { getWorkItemPlanRepository, type WorkItemPlanRepository } from '../../database/repository/work-item-plan.repository.js';
import { buildPlanningContext } from '../../planning/context-builder.js';
import { getPlanningRuleEngine, type PlanningRuleEngine } from '../../planning/engine.js';
import { formatPlanMarkdown } from '../../planning/plan-formatter.js';
import type { PlannedWorkItem, ValidationResult, WorkItemPlan } from '../../planning/types.js';
import { getDeploymentApprovalManager, type DeploymentApprovalManager } from './approval.js';
import { computePlanHash, runAuthorizedWrite } from '../write/authorization.js';
import {
    getWriteApprovalRepository,
    type WriteApprovalRepository
} from '../../database/repository/write-approval.repository.js';
import { buildCreatePatch, workItemApiUrl } from './patch.js';

const log = createLogger('deploy-engine');
const TYPE_ORDER: Record<string, number> = { Epic: 0, Feature: 1, 'User Story': 2, Task: 3, Bug: 4 };

export interface DeploymentItemResult {
    temporaryId: string;
    type: string;
    title: string;
    adoId: number | null;
    url: string | null;
    status: string;
    creationStatus: string;
    verificationStatus: string;
    errorCode: string | null;
    errorMessage: string | null;
}

export interface DeploymentResult {
    deploymentId: string;
    planId: string;
    confirmationId?: string;
    status: string;
    /** Plan-level state machine position. Only APPROVED plans may execute. */
    planStatus?: string;
    createdCount: number;
    failedCount: number;
    reusedCount: number;
    items: DeploymentItemResult[];
    validation?: ValidationResult;
    markdown: string;
}

const locks = new Set<string>();

export class DeploymentEngine {
    constructor(
        private readonly plans: WorkItemPlanRepository = getWorkItemPlanRepository(),
        private readonly deployments: DeploymentRepository = getDeploymentRepository(),
        private readonly approval: DeploymentApprovalManager = getDeploymentApprovalManager(),
        private readonly engine: PlanningRuleEngine = getPlanningRuleEngine(),
        private readonly approvals: WriteApprovalRepository = getWriteApprovalRepository()
    ) {}

    async prepare(planId: string): Promise<DeploymentResult> {
        const config = getConfig();
        const stored = this.requirePlan(planId, config.userId);
        if (stored.status === 'COMPLETED') {
            throw new AppError('INVALID_INPUT', 'This plan has already been deployed.');
        }
        if (stored.status === 'DEPLOYING') {
            throw new AppError('INVALID_INPUT', 'This plan is already being deployed.');
        }
        if (stored.status === 'EXPIRED' || new Date(stored.expiresAt).getTime() < Date.now()) {
            throw new AppError('INVALID_INPUT', 'This plan has expired. Create a new plan.');
        }
        if (!stored.plan.workItems.length) {
            throw new AppError('INVALID_INPUT', 'This plan has no work items to deploy.');
        }

        const context = await buildPlanningContext();
        const validation = this.engine.validate(stored.plan, context);
        if (!validation.valid) {
            stored.plan.status = 'INVALID';
            this.plans.updateStatus(stored.planId, config.userId, 'INVALID');
            throw new AppError(
                'INVALID_INPUT',
                `Plan ${stored.planId} has ${validation.errors.length} validation error(s) and cannot be deployed.`,
                { hint: validation.errors.map(e => e.message).join('; ') }
            );
        }

        const existing = this.deployments.latestForPlan(stored.planId, config.userId);
        const deploymentId =
            existing && (existing.status === 'PENDING' || existing.status === 'PARTIALLY_COMPLETED')
                ? existing.deploymentId
                : `DPL-${randomBytes(4).toString('hex').toUpperCase()}`;
        if (!existing || existing.deploymentId !== deploymentId) {
            this.deployments.insert({
                deploymentId,
                planId: stored.planId,
                userId: config.userId,
                status: 'PENDING',
                createdCount: 0,
                failedCount: 0,
                errorSummary: null,
                createdAt: new Date().toISOString(),
                startedAt: null,
                completedAt: null
            });
            for (const item of stored.plan.workItems) {
                this.deployments.upsertItem(this.pendingItem(deploymentId, item));
            }
        }

        // Preparing is not approving. The plan waits here until the user has seen
        // the preview below and explicitly confirms it.
        this.plans.updateStatus(stored.planId, config.userId, 'AWAITING_CONFIRMATION');
        const pending = this.approval.create({
            userId: config.userId,
            planId: stored.planId,
            planVersion: stored.version,
            planHash: computePlanHash(stored.plan),
            deploymentId
        });
        const items = this.deployments.listItems(deploymentId);
        const remaining = items.filter(i => i.creationStatus === 'PENDING' || i.status === 'FAILED').length;
        return {
            deploymentId,
            planId: stored.planId,
            confirmationId: pending.confirmationId,
            status: 'PENDING',
            planStatus: 'AWAITING_CONFIRMATION',
            createdCount: items.filter(i => i.creationStatus === 'SUCCESS' || i.status === 'REUSED').length,
            failedCount: items.filter(i => i.status === 'FAILED').length,
            reusedCount: items.filter(i => i.status === 'REUSED').length,
            items: items.map(toResult),
            validation,
            markdown: formatPreview(stored.plan, validation, pending.confirmationId, remaining)
        };
    }

    async confirm(confirmationId: string): Promise<DeploymentResult> {
        const config = getConfig();
        const pending = this.approval.claim(confirmationId, config.userId);

        // The approval is bound to exact plan content. Anything that changed the
        // plan since the preview was shown invalidates it.
        const stored = this.requirePlan(pending.planId, config.userId);
        if (stored.status !== 'AWAITING_CONFIRMATION') {
            throw new AppError(
                'WRITE_NOT_AUTHORIZED',
                `Plan ${pending.planId} is ${stored.status}, not awaiting confirmation. Prepare the deployment again.`
            );
        }
        this.assertPlanUnchanged(stored, pending.planVersion, pending.planHash);

        this.approval.markApproved(pending.confirmationId);
        this.plans.updateStatus(pending.planId, config.userId, 'APPROVED');

        return await runAuthorizedWrite(
            {
                confirmationId: pending.confirmationId,
                scope: 'deployment',
                subjectId: pending.deploymentId,
                planId: pending.planId,
                planVersion: pending.planVersion,
                planHash: pending.planHash,
                approvedAt: new Date().toISOString()
            },
            () => this.execute(pending.deploymentId, pending.planId, config.userId, pending.confirmationId)
        );
    }

    private assertPlanUnchanged(
        stored: { planId: string; version: number; plan: WorkItemPlan },
        approvedVersion: number,
        approvedHash: string
    ): void {
        if (stored.version !== approvedVersion) {
            throw new AppError(
                'WRITE_CONFIRMATION_INVALID',
                `This confirmation was issued for ${stored.planId} v${approvedVersion}, but the plan is now v${stored.version}. Prepare the deployment again and re-confirm.`
            );
        }
        if (computePlanHash(stored.plan) !== approvedHash) {
            throw new AppError(
                'WRITE_CONFIRMATION_INVALID',
                `The contents of ${stored.planId} changed after this confirmation was issued. Prepare the deployment again and re-confirm.`
            );
        }
    }

    async retry(deploymentId: string): Promise<DeploymentResult> {
        const config = getConfig();
        const deployment = this.deployments.get(deploymentId.trim(), config.userId);
        if (!deployment) throw new AppError('NOT_FOUND', `Deployment ${deploymentId} was not found.`);
        if (deployment.status === 'COMPLETED') {
            throw new AppError('INVALID_INPUT', 'This plan has already been deployed.');
        }
        if (deployment.status === 'DEPLOYING') {
            throw new AppError('INVALID_INPUT', 'This plan is already being deployed.');
        }
        // A retry resumes work the user already approved. It never introduces new
        // work, so it reuses the recorded approval - but only while the plan the
        // user approved is still the plan on disk.
        const approval = this.approvals.latestApprovedForSubject('deployment', deployment.deploymentId, config.userId);
        if (!approval) {
            throw new AppError(
                'WRITE_NOT_AUTHORIZED',
                `Deployment ${deployment.deploymentId} has no recorded user approval. Prepare the deployment again and confirm it.`
            );
        }
        const stored = this.requirePlan(deployment.planId, config.userId);
        this.assertPlanUnchanged(stored, approval.planVersion ?? stored.version, approval.planHash ?? '');

        return await runAuthorizedWrite(
            {
                confirmationId: approval.confirmationId,
                scope: 'deployment',
                subjectId: deployment.deploymentId,
                planId: deployment.planId,
                planVersion: approval.planVersion,
                planHash: approval.planHash,
                approvedAt: approval.approvedAt ?? new Date().toISOString()
            },
            () => this.execute(deployment.deploymentId, deployment.planId, config.userId, approval.confirmationId)
        );
    }

    async status(deploymentId: string): Promise<DeploymentResult> {
        const config = getConfig();
        const deployment = this.deployments.get(deploymentId.trim(), config.userId);
        if (!deployment) throw new AppError('NOT_FOUND', `Deployment ${deploymentId} was not found.`);
        const items = this.deployments.listItems(deployment.deploymentId);
        return {
            deploymentId: deployment.deploymentId,
            planId: deployment.planId,
            status: deployment.status,
            createdCount: deployment.createdCount,
            failedCount: deployment.failedCount,
            reusedCount: items.filter(i => i.status === 'REUSED').length,
            items: items.map(toResult),
            markdown: formatResultMarkdown(deployment, items)
        };
    }

    private async execute(
        deploymentId: string,
        planId: string,
        userId: string,
        confirmationId: string
    ): Promise<DeploymentResult> {
        if (locks.has(planId)) {
            throw new AppError('INVALID_INPUT', 'This plan is already being deployed.');
        }
        locks.add(planId);
        const config = getConfig();
        try {
            const stored = this.requirePlan(planId, userId);
            if (stored.status === 'COMPLETED') {
                throw new AppError('INVALID_INPUT', 'This plan has already been deployed.');
            }
            const priorRows = this.deployments.listItems(deploymentId);
            const adoByTemp = new Map(priorRows.filter(row => row.adoId).map(row => [row.temporaryId, row.adoId as number]));
            const planForRules = {
                ...stored.plan,
                workItems: stored.plan.workItems.map(item => ({
                    ...item,
                    existingAdoId: item.existingAdoId ?? adoByTemp.get(item.temporaryId) ?? item.existingAdoId
                }))
            };
            const context = await buildPlanningContext();
            const validation = this.engine.validate(planForRules, context);
            if (!validation.valid) {
                throw new AppError('INVALID_INPUT', 'Plan is no longer valid and cannot be deployed.');
            }

            this.plans.updateStatus(planId, userId, 'DEPLOYING');
            const deployment = this.deployments.get(deploymentId, userId);
            if (!deployment) throw new AppError('NOT_FOUND', 'Deployment record missing.');
            deployment.status = 'DEPLOYING';
            deployment.startedAt = new Date().toISOString();
            this.deployments.update(deployment);

            const byTemp = new Map(stored.plan.workItems.map(item => [item.temporaryId, item]));
            const existingItems = this.deployments.listItems(deploymentId);
            const map = new Map<string, number>();
            for (const row of existingItems) {
                if (row.adoId) map.set(row.temporaryId, row.adoId);
            }
            for (const item of stored.plan.workItems) {
                if (item.existingAdoId) map.set(item.temporaryId, item.existingAdoId);
            }

            const ordered = [...stored.plan.workItems].sort(
                (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
            );

            for (const item of ordered) {
                const prior = existingItems.find(row => row.temporaryId === item.temporaryId);
                if (prior && (prior.creationStatus === 'SUCCESS' || prior.status === 'REUSED') && prior.adoId) {
                    map.set(item.temporaryId, prior.adoId);
                    continue;
                }
                if (item.existingAdoId) {
                    const url = getNavigationEngine().getWorkItemUrl(config.ado.project, item.existingAdoId);
                    this.deployments.upsertItem({
                        ...this.pendingItem(deploymentId, item),
                        adoId: item.existingAdoId,
                        url,
                        status: 'REUSED',
                        creationStatus: 'SKIPPED',
                        verificationStatus: 'SKIPPED',
                        completedAt: new Date().toISOString()
                    });
                    map.set(item.temporaryId, item.existingAdoId);
                    continue;
                }

                const parentId = item.parentTemporaryId ? map.get(item.parentTemporaryId) ?? null : null;
                if (item.parentTemporaryId && !parentId) {
                    this.failItem(deploymentId, item, parentId, 'RELATION_ERROR', 'Parent was not created, so this item was not created.');
                    continue;
                }

                const parentApiUrl = parentId
                    ? workItemApiUrl(config.ado.baseUrl, config.ado.project, parentId)
                    : null;
                try {
                    const patch = await buildCreatePatch(config.ado.project, item, parentApiUrl);
                    const result = await getWorkItemOperationService().create(String(item.type), patch);
                    map.set(item.temporaryId, result.id);
                    const url = result.url ?? getNavigationEngine().getWorkItemUrl(config.ado.project, result.id);
                    this.deployments.upsertItem({
                        ...this.pendingItem(deploymentId, item),
                        adoId: result.id,
                        url,
                        parentAdoId: parentId,
                        status: 'CREATED',
                        creationStatus: 'SUCCESS',
                        verificationStatus: result.verificationStatus,
                        errorCode: result.verificationStatus === 'FAILED' ? 'VERIFICATION_ERROR' : null,
                        errorMessage: result.verificationMessage,
                        completedAt: new Date().toISOString()
                    });
                } catch (error) {
                    const classified = classify(error);
                    this.failItem(deploymentId, item, parentId, classified.code, classified.message);
                    log.warn('Deployment item failed', {
                        deploymentId,
                        temporaryId: item.temporaryId,
                        code: classified.code
                    });
                }
            }

            this.approval.markExecuted(confirmationId);
            const items = this.deployments.listItems(deploymentId);
            const created = items.filter(i => i.creationStatus === 'SUCCESS').length;
            const reused = items.filter(i => i.status === 'REUSED').length;
            const failed = items.filter(i => i.status === 'FAILED').length;
            const verifyFailed = items.filter(i => i.verificationStatus === 'FAILED').length;
            let status: DeploymentRecord['status'] = 'COMPLETED';
            let planStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' = 'COMPLETED';
            if (failed > 0 && created + reused > 0) {
                status = 'PARTIALLY_COMPLETED';
                planStatus = 'PARTIALLY_COMPLETED';
            } else if (failed > 0) {
                status = 'FAILED';
                planStatus = 'FAILED';
            } else if (verifyFailed > 0) {
                status = 'PARTIALLY_COMPLETED';
                planStatus = 'PARTIALLY_COMPLETED';
            }
            const updated: DeploymentRecord = {
                ...deployment,
                status,
                createdCount: created,
                failedCount: failed,
                errorSummary: failed ? items.find(i => i.errorMessage)?.errorMessage ?? null : null,
                completedAt: new Date().toISOString()
            };
            this.deployments.update(updated);
            this.plans.updateStatus(planId, userId, planStatus);

            return {
                deploymentId,
                planId,
                confirmationId,
                status,
                createdCount: created,
                failedCount: failed,
                reusedCount: reused,
                items: items.map(toResult),
                validation,
                markdown: formatResultMarkdown(updated, items)
            };
        } finally {
            locks.delete(planId);
        }
    }

    private requirePlan(planId: string, userId: string) {
        const stored = this.plans.getByPlanId(planId.trim(), userId);
        if (!stored) throw new AppError('NOT_FOUND', `Plan ${planId} was not found for this user.`);
        return stored;
    }

    private pendingItem(deploymentId: string, item: PlannedWorkItem): DeploymentItemRecord {
        return {
            deploymentId,
            temporaryId: item.temporaryId,
            workItemType: String(item.type),
            title: item.title ?? null,
            adoId: item.existingAdoId ?? null,
            url: null,
            parentTemporaryId: item.parentTemporaryId ?? null,
            parentAdoId: null,
            status: 'PENDING',
            creationStatus: 'PENDING',
            verificationStatus: 'PENDING',
            errorCode: null,
            errorMessage: null,
            createdAt: new Date().toISOString(),
            completedAt: null
        };
    }

    private failItem(
        deploymentId: string,
        item: PlannedWorkItem,
        parentAdoId: number | null,
        errorCode: string,
        errorMessage: string
    ): void {
        this.deployments.upsertItem({
            ...this.pendingItem(deploymentId, item),
            parentAdoId,
            status: 'FAILED',
            creationStatus: 'FAILED',
            verificationStatus: 'SKIPPED',
            errorCode,
            errorMessage,
            completedAt: new Date().toISOString()
        });
    }
}

function toResult(item: DeploymentItemRecord): DeploymentItemResult {
    return {
        temporaryId: item.temporaryId,
        type: item.workItemType ?? '',
        title: item.title ?? '',
        adoId: item.adoId,
        url: item.url,
        status: item.status,
        creationStatus: item.creationStatus,
        verificationStatus: item.verificationStatus,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage
    };
}

function classify(error: unknown): { code: string; message: string } {
    if (error instanceof AppError) {
        const map: Record<string, string> = {
            ADO_AUTH_FAILED: 'AUTHORIZATION_FAILURE',
            ADO_FORBIDDEN: 'AUTHORIZATION_FAILURE',
            ADO_NOT_FOUND: 'NOT_FOUND',
            ADO_RATE_LIMITED: 'RATE_LIMIT',
            ADO_SERVER_ERROR: 'SERVER_ERROR',
            ADO_NETWORK_ERROR: 'NETWORK_ERROR',
            ADO_BAD_REQUEST: 'VALIDATION_FAILURE',
            WRITE_FAILED: 'SERVER_ERROR'
        };
        return { code: map[error.code] ?? error.code, message: error.message };
    }
    return { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Deployment item failed.' };
}

function counts(plan: WorkItemPlan): string {
    const tally = (type: string) => plan.workItems.filter(i => i.type === type).length;
    return `${tally('Epic')} Epic(s), ${tally('Feature')} Feature(s), ${tally('User Story')} User Story(ies), ${tally('Task')} Task(s)`;
}

function formatPreview(plan: WorkItemPlan, validation: ValidationResult, confirmationId: string, remaining: number): string {
    const warnings = validation.warnings.map(w => `- ${w.message}`).join('\n') || '- none';
    return [
        'PROPOSED PLAN — AWAITING YOUR CONFIRMATION',
        '',
        counts(plan),
        plan.planId ? `Plan: ${plan.planId}` : '',
        formatPlanMarkdown(plan),
        '',
        `All mandatory planning rules passed. Remaining to create: ${remaining}.`,
        '',
        'Warnings:',
        warnings,
        '',
        'No Azure DevOps changes have been made yet.',
        '',
        'Review the plan above. Change it with sherlock_modify_work_plan (which invalidates this confirmation),',
        'or confirm it to create the work items.',
        '',
        `Deployment Confirmation: ${confirmationId}`
    ].join('\n');
}

function formatResultMarkdown(deployment: DeploymentRecord, items: DeploymentItemRecord[]): string {
    const created = items.filter(i => i.creationStatus === 'SUCCESS');
    const failed = items.filter(i => i.status === 'FAILED');
    const lines = [
        deployment.status === 'COMPLETED' ? 'S.H.E.R.L.O.C.K. Deployment Complete' : 'S.H.E.R.L.O.C.K. Deployment Partially Completed',
        '',
        `Created: ${created.length}`,
        `Failed: ${failed.length}`,
        '',
        'Successful items:'
    ];
    for (const item of created) {
        lines.push(`- ${item.workItemType} #${item.adoId} ${item.title ?? ''} ${item.url ?? ''}`.trim());
        if (item.verificationStatus === 'FAILED') {
            lines.push(`  Created successfully, but verification failed. ${item.errorMessage ?? ''}`);
        }
    }
    if (failed.length) {
        lines.push('', 'Failed items:');
        for (const item of failed) {
            lines.push(`- ${item.temporaryId} ${item.title ?? ''}: ${item.errorMessage ?? item.errorCode}`);
        }
        lines.push('', 'Successful items were not rolled back. Retry is available for failed items only.');
    }
    lines.push('', `Deployment ID: ${deployment.deploymentId}`);
    return lines.join('\n');
}

let shared: DeploymentEngine | null = null;

export function getDeploymentEngine(): DeploymentEngine {
    shared ??= new DeploymentEngine();
    return shared;
}

export function resetDeploymentEngine(): void {
    shared = null;
    locks.clear();
}
