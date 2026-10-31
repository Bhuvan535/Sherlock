import { randomBytes } from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import { assertPresented } from './authorization.js';
import {
    getWriteApprovalRepository,
    type WriteApprovalRepository
} from '../../database/repository/write-approval.repository.js';
import type { PendingWrite, PlannedWrite } from './types.js';

const TTL_MS = 8 * 60 * 1000;

/**
 * Holds prepared single-work-item operations while they wait for the user.
 *
 * `create` produces an AWAITING_CONFIRMATION operation and nothing more.
 * `claim`, reached only from the explicit confirmation tool, is the single
 * transition to APPROVED, and it refuses any operation whose preview was never
 * returned to the client.
 */
export class WriteApprovalManager {
    private readonly pending = new Map<string, PendingWrite>();

    constructor(private readonly repo: WriteApprovalRepository = getWriteApprovalRepository()) {}

    create(userId: string, planned: PlannedWrite): PendingWrite {
        const confirmationId = `WRITE-${randomBytes(3).toString('hex').toUpperCase()}`;
        const requestId = randomBytes(8).toString('hex');
        const record: PendingWrite = {
            confirmationId,
            requestId,
            userId,
            expiresAt: Date.now() + TTL_MS,
            planned,
            executed: false
        };
        this.pending.set(confirmationId, record);
        this.repo.insert({
            confirmationId,
            userId,
            scope: 'work_item',
            subjectId: planned.workItemId ? String(planned.workItemId) : planned.operation,
            planId: null,
            planVersion: null,
            planHash: null,
            state: 'AWAITING_CONFIRMATION',
            presentedAt: null,
            approvedAt: null,
            consumedAt: null,
            createdAt: new Date().toISOString()
        });
        return record;
    }

    get(confirmationId: string): PendingWrite | undefined {
        return this.pending.get(confirmationId.trim());
    }

    claim(confirmationId: string, userId: string): PendingWrite {
        const record = this.pending.get(confirmationId.trim());
        if (!record) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'Unknown confirmation ID. Prepare the write again.');
        }
        if (record.userId !== userId) {
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'This confirmation belongs to a different operator.');
        }
        if (record.executed) {
            return record;
        }
        if (Date.now() > record.expiresAt) {
            this.pending.delete(record.confirmationId);
            this.repo.setState(record.confirmationId, 'EXPIRED');
            throw new AppError('WRITE_CONFIRMATION_INVALID', 'This confirmation has expired. Prepare the write again.');
        }
        assertPresented(record.confirmationId);
        this.repo.setState(record.confirmationId, 'APPROVED');
        return record;
    }

    markExecuted(confirmationId: string, result?: Record<string, unknown>): void {
        const record = this.pending.get(confirmationId);
        if (record) {
            record.executed = true;
            if (result) record.result = result;
        }
        this.repo.setState(confirmationId, 'CONSUMED');
    }

    clear(): void {
        this.pending.clear();
    }
}

let shared: WriteApprovalManager | null = null;

export function getWriteApprovalManager(): WriteApprovalManager {
    shared ??= new WriteApprovalManager();
    return shared;
}

export function resetWriteApprovalManager(): void {
    shared?.clear();
    shared = null;
}
