import { getDatabase, type Database } from '../connection.js';

export type WriteOperationStatus = 'pending' | 'success' | 'failed' | 'conflict' | 'expired';
export type WriteOperationType =
    | 'CREATE_WORK_ITEM'
    | 'UPDATE_WORK_ITEM'
    | 'SET_PARENT'
    | 'REMOVE_PARENT'
    | 'ADD_PREDECESSOR'
    | 'REMOVE_PREDECESSOR'
    | 'ADD_COMMENT';

export interface WriteOperationRecord {
    requestId: string;
    confirmationId: string;
    userId: string;
    operationType: WriteOperationType;
    workItemId: number | null;
    workItemType: string | null;
    status: WriteOperationStatus;
    beforeData: string | null;
    requestedChanges: string;
    afterData: string | null;
    errorCode: string | null;
    createdAt: string;
    completedAt: string | null;
}

interface RawRow {
    id: number;
    request_id: string;
    confirmation_id: string;
    user_id: string;
    operation_type: string;
    work_item_id: number | null;
    work_item_type: string | null;
    status: string;
    before_data: string | null;
    requested_changes: string;
    after_data: string | null;
    error_code: string | null;
    created_at: string;
    completed_at: string | null;
}

export class WriteOperationRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insert(record: WriteOperationRecord): void {
        this.db.run(
            `INSERT INTO write_operations (
                request_id, confirmation_id, user_id, operation_type, work_item_id, work_item_type,
                status, before_data, requested_changes, after_data, error_code, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.requestId,
                record.confirmationId,
                record.userId,
                record.operationType,
                record.workItemId,
                record.workItemType,
                record.status,
                record.beforeData,
                record.requestedChanges,
                record.afterData,
                record.errorCode,
                record.createdAt,
                record.completedAt
            ]
        );
    }

    getByConfirmationId(confirmationId: string): WriteOperationRecord | undefined {
        const row = this.db.get<RawRow>(`SELECT * FROM write_operations WHERE confirmation_id = ?`, [confirmationId]);
        return row ? this.map(row) : undefined;
    }

    complete(
        confirmationId: string,
        status: WriteOperationStatus,
        afterData: string | null,
        errorCode: string | null,
        workItemId?: number | null
    ): void {
        this.db.run(
            `UPDATE write_operations
             SET status = ?, after_data = ?, error_code = ?, completed_at = ?, work_item_id = COALESCE(?, work_item_id)
             WHERE confirmation_id = ?`,
            [status, afterData, errorCode, new Date().toISOString(), workItemId ?? null, confirmationId]
        );
    }

    private map(row: RawRow): WriteOperationRecord {
        return {
            requestId: row.request_id,
            confirmationId: row.confirmation_id,
            userId: row.user_id,
            operationType: row.operation_type as WriteOperationType,
            workItemId: row.work_item_id,
            workItemType: row.work_item_type,
            status: row.status as WriteOperationStatus,
            beforeData: row.before_data,
            requestedChanges: row.requested_changes,
            afterData: row.after_data,
            errorCode: row.error_code,
            createdAt: row.created_at,
            completedAt: row.completed_at
        };
    }
}

let shared: WriteOperationRepository | null = null;

export function getWriteOperationRepository(): WriteOperationRepository {
    shared ??= new WriteOperationRepository();
    return shared;
}

export function setWriteOperationRepositoryForTesting(repo: WriteOperationRepository | null): void {
    shared = repo;
}
