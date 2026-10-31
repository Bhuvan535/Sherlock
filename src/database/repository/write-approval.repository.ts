import { getDatabase, type Database } from '../connection.js';
import type { ApprovalScope } from '../../services/write/authorization.js';

/**
 * Lifecycle of a single approval token.
 *
 *   AWAITING_CONFIRMATION -> APPROVED -> CONSUMED
 *                         \-> SUPERSEDED (the plan changed underneath it)
 *                         \-> EXPIRED
 */
export type ApprovalState = 'AWAITING_CONFIRMATION' | 'APPROVED' | 'CONSUMED' | 'SUPERSEDED' | 'EXPIRED';

export interface WriteApprovalRecord {
    confirmationId: string;
    userId: string;
    scope: ApprovalScope;
    subjectId: string;
    planId: string | null;
    planVersion: number | null;
    planHash: string | null;
    state: ApprovalState;
    presentedAt: string | null;
    approvedAt: string | null;
    consumedAt: string | null;
    createdAt: string;
}

export class WriteApprovalRepository {
    /**
     * Resolved per call rather than captured: approvals are read and written
     * across the whole lifetime of the process (and across test harness
     * databases), so this must never hold a stale handle.
     */
    private get db(): Database {
        return this.override ?? getDatabase();
    }

    constructor(private readonly override?: Database) {}

    insert(record: WriteApprovalRecord): void {
        this.db.run(
            `INSERT INTO write_approvals (
                confirmation_id, user_id, scope, subject_id, plan_id, plan_version, plan_hash,
                state, presented_at, approved_at, consumed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(confirmation_id) DO UPDATE SET
                state = excluded.state,
                plan_version = excluded.plan_version,
                plan_hash = excluded.plan_hash,
                presented_at = excluded.presented_at,
                approved_at = excluded.approved_at,
                consumed_at = excluded.consumed_at`,
            [
                record.confirmationId,
                record.userId,
                record.scope,
                record.subjectId,
                record.planId,
                record.planVersion,
                record.planHash,
                record.state,
                record.presentedAt,
                record.approvedAt,
                record.consumedAt,
                record.createdAt
            ]
        );
    }

    setState(confirmationId: string, state: ApprovalState, at: string = new Date().toISOString()): void {
        const column = state === 'APPROVED' ? 'approved_at' : state === 'CONSUMED' ? 'consumed_at' : 'presented_at';
        this.db.run(
            `UPDATE write_approvals SET state = ?, ${column} = COALESCE(${column}, ?) WHERE confirmation_id = ?`,
            [state, at, confirmationId]
        );
    }

    markPresented(confirmationId: string, at: string = new Date().toISOString()): void {
        this.db.run(
            `UPDATE write_approvals SET presented_at = COALESCE(presented_at, ?) WHERE confirmation_id = ?`,
            [at, confirmationId]
        );
    }

    get(confirmationId: string): WriteApprovalRecord | undefined {
        const row = this.db.get<Record<string, unknown>>(
            `SELECT * FROM write_approvals WHERE confirmation_id = ?`,
            [confirmationId]
        );
        return row ? map(row) : undefined;
    }

    /** Most recent approval that actually executed for a subject, used to authorise retries. */
    latestApprovedForSubject(scope: ApprovalScope, subjectId: string, userId: string): WriteApprovalRecord | undefined {
        const row = this.db.get<Record<string, unknown>>(
            `SELECT * FROM write_approvals
             WHERE scope = ? AND subject_id = ? AND user_id = ? AND state IN ('APPROVED', 'CONSUMED')
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [scope, subjectId, userId]
        );
        return row ? map(row) : undefined;
    }

    /** Invalidates outstanding approvals for a plan. Called whenever the plan changes. */
    supersedeForPlan(planId: string, userId: string): number {
        return this.db.run(
            `UPDATE write_approvals SET state = 'SUPERSEDED'
             WHERE plan_id = ? AND user_id = ? AND state IN ('AWAITING_CONFIRMATION', 'APPROVED')`,
            [planId, userId]
        ).changes;
    }
}

function map(row: Record<string, unknown>): WriteApprovalRecord {
    return {
        confirmationId: String(row.confirmation_id),
        userId: String(row.user_id),
        scope: row.scope as ApprovalScope,
        subjectId: String(row.subject_id),
        planId: (row.plan_id as string | null) ?? null,
        planVersion: row.plan_version === null || row.plan_version === undefined ? null : Number(row.plan_version),
        planHash: (row.plan_hash as string | null) ?? null,
        state: row.state as ApprovalState,
        presentedAt: (row.presented_at as string | null) ?? null,
        approvedAt: (row.approved_at as string | null) ?? null,
        consumedAt: (row.consumed_at as string | null) ?? null,
        createdAt: String(row.created_at)
    };
}

let shared: WriteApprovalRepository | null = null;

export function getWriteApprovalRepository(): WriteApprovalRepository {
    shared ??= new WriteApprovalRepository();
    return shared;
}

export function setWriteApprovalRepositoryForTesting(repo: WriteApprovalRepository | null): void {
    shared = repo;
}
