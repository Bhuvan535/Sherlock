import { randomBytes } from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import { assertPresented } from '../write/authorization.js';
import {
    getWriteApprovalRepository,
    type WriteApprovalRepository
} from '../../database/repository/write-approval.repository.js';

const TTL_MS = 8 * 60 * 1000;

export interface PendingDeployment {
    confirmationId: string;
    userId: string;
    planId: string;
    planVersion: number;
    planHash: string;
    deploymentId: string;
    expiresAt: number;
    executed: boolean;
}

/**
 * Issues and claims deployment approvals.
 *
 * Creating a token means "awaiting confirmation" - never "approved". Only
 * `claim`, which runs from the explicit confirmation tool, moves an operation
 * to APPROVED, and it refuses tokens whose proposal was never shown to the
 * user.
 */
export class DeploymentApprovalManager {
    private readonly pending = new Map<string, PendingDeployment>();

    constructor(private readonly repo: WriteApprovalRepository = getWriteApprovalRepository()) {}

    create(input: Omit<PendingDeployment, 'confirmationId' | 'expiresAt' | 'executed'>): PendingDeployment {
        const confirmationId = `DEPLOY-${randomBytes(3).toString('hex').toUpperCase()}`;
        const record: PendingDeployment = {
            ...input,
            confirmationId,
            expiresAt: Date.now() + TTL_MS,
            executed: false
        };
        this.pending.set(confirmationId, record);
        this.repo.insert({
            confirmationId,
            userId: input.userId,
            scope: 'deployment',
            subjectId: input.deploymentId,
            planId: input.planId,
            planVersion: input.planVersion,
            planHash: input.planHash,
            state: 'AWAITING_CONFIRMATION',
            presentedAt: null,
            approvedAt: null,
            consumedAt: null,
            createdAt: new Date().toISOString()
        });
        return record;
    }

    claim(confirmationId: string, userId: string): PendingDeployment {
        const record = this.pending.get(confirmationId.trim());
        if (!record) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'Unknown confirmation ID. Prepare the deployment again.');
        }
        if (record.userId !== userId) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'This confirmation belongs to a different operator.');
        }
        if (record.executed) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'This confirmation has already been used.');
        }
        if (Date.now() > record.expiresAt) {
            this.pending.delete(record.confirmationId);
            this.repo.setState(record.confirmationId, 'EXPIRED');
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'This confirmation has expired. Prepare the deployment again.');
        }

        const stored = this.repo.get(record.confirmationId);
        if (stored && stored.state === 'SUPERSEDED') {
            throw new AppError(
                'WRITE_CONFIRMATION_INVALID',
                'The plan changed after this confirmation was issued. Prepare the deployment again and re-confirm the updated plan.'
            );
        }
        assertPresented(record.confirmationId);
        return record;
    }

    /** Records the APPROVED transition. Called only from an explicit confirmation. */
    markApproved(confirmationId: string): void {
        this.repo.setState(confirmationId, 'APPROVED');
    }

    markExecuted(confirmationId: string): void {
        const record = this.pending.get(confirmationId);
        if (record) record.executed = true;
        this.repo.setState(confirmationId, 'CONSUMED');
    }

    clear(): void {
        this.pending.clear();
    }
}

let shared: DeploymentApprovalManager | null = null;

export function getDeploymentApprovalManager(): DeploymentApprovalManager {
    shared ??= new DeploymentApprovalManager();
    return shared;
}

export function resetDeploymentApprovalManager(): void {
    shared?.clear();
    shared = null;
}
