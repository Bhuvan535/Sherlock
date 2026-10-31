import { getDatabase, type Database } from '../connection.js';
import type { PlanStatus, ValidationResult, WorkItemPlan } from '../../planning/types.js';

export interface StoredWorkItemPlan {
    planId: string;
    userId: string;
    team: string;
    project: string;
    version: number;
    status: PlanStatus;
    plan: WorkItemPlan;
    validation: ValidationResult;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
}

interface RawRow {
    plan_id: string;
    user_id: string;
    team: string;
    project: string;
    version: number;
    status: string;
    plan_data: string;
    validation_data: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
}

export class WorkItemPlanRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insert(record: StoredWorkItemPlan): void {
        this.db.run(
            `INSERT INTO work_item_plans (
                plan_id, user_id, team, project, version, status,
                plan_data, validation_data, created_at, updated_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.planId,
                record.userId,
                record.team,
                record.project,
                record.version,
                record.status,
                JSON.stringify(record.plan),
                JSON.stringify(record.validation),
                record.createdAt,
                record.updatedAt,
                record.expiresAt
            ]
        );
    }

    update(record: StoredWorkItemPlan): void {
        this.db.run(
            `UPDATE work_item_plans
             SET version = ?, status = ?, plan_data = ?, validation_data = ?, updated_at = ?, expires_at = ?
             WHERE plan_id = ? AND user_id = ?`,
            [
                record.version,
                record.status,
                JSON.stringify(record.plan),
                JSON.stringify(record.validation),
                record.updatedAt,
                record.expiresAt,
                record.planId,
                record.userId
            ]
        );
    }

    updateStatus(planId: string, userId: string, status: PlanStatus): void {
        this.db.run(
            `UPDATE work_item_plans SET status = ?, updated_at = ? WHERE plan_id = ? AND user_id = ?`,
            [status, new Date().toISOString(), planId, userId]
        );
    }

    getByPlanId(planId: string, userId: string): StoredWorkItemPlan | undefined {
        const row = this.db.get<RawRow>(
            `SELECT * FROM work_item_plans WHERE plan_id = ? AND user_id = ?`,
            [planId, userId]
        );
        return row ? this.map(row) : undefined;
    }

    private map(row: RawRow): StoredWorkItemPlan {
        return {
            planId: row.plan_id,
            userId: row.user_id,
            team: row.team,
            project: row.project,
            version: row.version,
            status: row.status as PlanStatus,
            plan: JSON.parse(row.plan_data) as WorkItemPlan,
            validation: JSON.parse(row.validation_data) as ValidationResult,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            expiresAt: row.expires_at
        };
    }
}

let shared: WorkItemPlanRepository | null = null;

export function getWorkItemPlanRepository(): WorkItemPlanRepository {
    shared ??= new WorkItemPlanRepository();
    return shared;
}

export function setWorkItemPlanRepositoryForTesting(repo: WorkItemPlanRepository | null): void {
    shared = repo;
}
