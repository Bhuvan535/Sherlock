import { getDatabase, type Database } from '../connection.js';

export type DeploymentStatus =
    | 'PENDING'
    | 'DEPLOYING'
    | 'COMPLETED'
    | 'PARTIALLY_COMPLETED'
    | 'FAILED';

export type ItemDeployStatus = 'PENDING' | 'CREATED' | 'REUSED' | 'FAILED';
export type CreationStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
export type VerificationStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface DeploymentRecord {
    deploymentId: string;
    planId: string;
    userId: string;
    status: DeploymentStatus;
    createdCount: number;
    failedCount: number;
    errorSummary: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
}

export interface DeploymentItemRecord {
    deploymentId: string;
    temporaryId: string;
    workItemType: string | null;
    title: string | null;
    adoId: number | null;
    url: string | null;
    parentTemporaryId: string | null;
    parentAdoId: number | null;
    status: ItemDeployStatus;
    creationStatus: CreationStatus;
    verificationStatus: VerificationStatus;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    completedAt: string | null;
}

export class DeploymentRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insert(record: DeploymentRecord): void {
        this.db.run(
            `INSERT INTO work_item_deployments (
                deployment_id, plan_id, user_id, status, created_count, failed_count,
                error_summary, created_at, started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.deploymentId,
                record.planId,
                record.userId,
                record.status,
                record.createdCount,
                record.failedCount,
                record.errorSummary,
                record.createdAt,
                record.startedAt,
                record.completedAt
            ]
        );
    }

    get(deploymentId: string, userId: string): DeploymentRecord | undefined {
        const row = this.db.get<Record<string, unknown>>(
            `SELECT * FROM work_item_deployments WHERE deployment_id = ? AND user_id = ?`,
            [deploymentId, userId]
        );
        return row ? this.mapDeployment(row) : undefined;
    }

    latestForPlan(planId: string, userId: string): DeploymentRecord | undefined {
        const row = this.db.get<Record<string, unknown>>(
            `SELECT * FROM work_item_deployments WHERE plan_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
            [planId, userId]
        );
        return row ? this.mapDeployment(row) : undefined;
    }

    update(record: DeploymentRecord): void {
        this.db.run(
            `UPDATE work_item_deployments
             SET status = ?, created_count = ?, failed_count = ?, error_summary = ?, started_at = ?, completed_at = ?
             WHERE deployment_id = ? AND user_id = ?`,
            [
                record.status,
                record.createdCount,
                record.failedCount,
                record.errorSummary,
                record.startedAt,
                record.completedAt,
                record.deploymentId,
                record.userId
            ]
        );
    }

    upsertItem(item: DeploymentItemRecord): void {
        this.db.run(
            `INSERT INTO work_item_deployment_items (
                deployment_id, temporary_id, work_item_type, title, ado_id, url,
                parent_temporary_id, parent_ado_id, status, creation_status, verification_status,
                error_code, error_message, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(deployment_id, temporary_id) DO UPDATE SET
                ado_id = excluded.ado_id,
                url = excluded.url,
                parent_ado_id = excluded.parent_ado_id,
                status = excluded.status,
                creation_status = excluded.creation_status,
                verification_status = excluded.verification_status,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                completed_at = excluded.completed_at`,
            [
                item.deploymentId,
                item.temporaryId,
                item.workItemType,
                item.title,
                item.adoId,
                item.url,
                item.parentTemporaryId,
                item.parentAdoId,
                item.status,
                item.creationStatus,
                item.verificationStatus,
                item.errorCode,
                item.errorMessage,
                item.createdAt,
                item.completedAt
            ]
        );
    }

    listItems(deploymentId: string): DeploymentItemRecord[] {
        return this.db
            .all<Record<string, unknown>>(
                `SELECT * FROM work_item_deployment_items WHERE deployment_id = ? ORDER BY id`,
                [deploymentId]
            )
            .map(row => this.mapItem(row));
    }

    private mapDeployment(row: Record<string, unknown>): DeploymentRecord {
        return {
            deploymentId: String(row.deployment_id),
            planId: String(row.plan_id),
            userId: String(row.user_id),
            status: row.status as DeploymentStatus,
            createdCount: Number(row.created_count),
            failedCount: Number(row.failed_count),
            errorSummary: (row.error_summary as string | null) ?? null,
            createdAt: String(row.created_at),
            startedAt: (row.started_at as string | null) ?? null,
            completedAt: (row.completed_at as string | null) ?? null
        };
    }

    private mapItem(row: Record<string, unknown>): DeploymentItemRecord {
        return {
            deploymentId: String(row.deployment_id),
            temporaryId: String(row.temporary_id),
            workItemType: (row.work_item_type as string | null) ?? null,
            title: (row.title as string | null) ?? null,
            adoId: (row.ado_id as number | null) ?? null,
            url: (row.url as string | null) ?? null,
            parentTemporaryId: (row.parent_temporary_id as string | null) ?? null,
            parentAdoId: (row.parent_ado_id as number | null) ?? null,
            status: row.status as ItemDeployStatus,
            creationStatus: row.creation_status as CreationStatus,
            verificationStatus: row.verification_status as VerificationStatus,
            errorCode: (row.error_code as string | null) ?? null,
            errorMessage: (row.error_message as string | null) ?? null,
            createdAt: String(row.created_at),
            completedAt: (row.completed_at as string | null) ?? null
        };
    }
}

let shared: DeploymentRepository | null = null;

export function getDeploymentRepository(): DeploymentRepository {
    shared ??= new DeploymentRepository();
    return shared;
}

export function setDeploymentRepositoryForTesting(repo: DeploymentRepository | null): void {
    shared = repo;
}
