/**
 * Local SQLite schema for the S.H.E.R.L.O.C.K. audit trail.
 *
 * What is stored: what the Team Lead did *through this MCP server* - which tools
 * ran, with what summarised parameters, what came back, and whether an action was
 * confirmed. This is not a mirror of Azure DevOps activity, because this server
 * cannot change Azure DevOps except via confirmed Phase 1 writes and saved queries.
 *
 * What is never stored: the Azure DevOps PAT or authorization headers.
 */
export const SCHEMA_VERSION = 5;

export const SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS schema_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS tl_activity (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at         TEXT    NOT NULL,
        category            TEXT    NOT NULL,
        action              TEXT    NOT NULL,
        tool                TEXT    NOT NULL,
        parameters_summary  TEXT,
        result_summary      TEXT,
        outcome             TEXT    NOT NULL,
        error_code          TEXT,
        confirmation_status TEXT    NOT NULL DEFAULT 'not_applicable',
        duration_ms         INTEGER,
        subject_ref         TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_occurred_at ON tl_activity (occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_category ON tl_activity (category, occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_tool ON tl_activity (tool, occurred_at DESC)`,

    `CREATE TABLE IF NOT EXISTS custom_skills (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT UNIQUE NOT NULL,
        description     TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        version         INTEGER NOT NULL DEFAULT 1,
        created_by      TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'active'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_custom_skills_name ON custom_skills (name)`,

    `CREATE TABLE IF NOT EXISTS write_operations (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id         TEXT    NOT NULL,
        confirmation_id    TEXT    UNIQUE NOT NULL,
        user_id            TEXT    NOT NULL,
        operation_type     TEXT    NOT NULL,
        work_item_id       INTEGER,
        work_item_type     TEXT,
        status             TEXT    NOT NULL,
        before_data        TEXT,
        requested_changes  TEXT    NOT NULL,
        after_data         TEXT,
        error_code         TEXT,
        created_at         TEXT    NOT NULL,
        completed_at       TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_write_ops_confirmation ON write_operations (confirmation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_write_ops_status ON write_operations (status, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS work_item_plans (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id          TEXT    UNIQUE NOT NULL,
        user_id          TEXT    NOT NULL,
        team             TEXT    NOT NULL,
        project          TEXT    NOT NULL,
        version          INTEGER NOT NULL,
        status           TEXT    NOT NULL,
        plan_data        TEXT    NOT NULL,
        validation_data  TEXT    NOT NULL,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL,
        expires_at       TEXT    NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_work_item_plans_user ON work_item_plans (user_id, updated_at DESC)`,

    `CREATE TABLE IF NOT EXISTS work_item_deployments (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id    TEXT    UNIQUE NOT NULL,
        plan_id          TEXT    NOT NULL,
        user_id          TEXT    NOT NULL,
        status           TEXT    NOT NULL,
        created_count    INTEGER NOT NULL DEFAULT 0,
        failed_count     INTEGER NOT NULL DEFAULT 0,
        error_summary    TEXT,
        created_at       TEXT    NOT NULL,
        started_at       TEXT,
        completed_at     TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deployments_plan ON work_item_deployments (plan_id, created_at DESC)`,

    // Approval evidence for every Azure DevOps mutation: which proposal was
    // shown, when, and whether the user explicitly confirmed it. Retries read
    // this to prove the work they resume was approved for the same plan content.
    `CREATE TABLE IF NOT EXISTS write_approvals (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        confirmation_id  TEXT    UNIQUE NOT NULL,
        user_id          TEXT    NOT NULL,
        scope            TEXT    NOT NULL,
        subject_id       TEXT    NOT NULL,
        plan_id          TEXT,
        plan_version     INTEGER,
        plan_hash        TEXT,
        state            TEXT    NOT NULL,
        presented_at     TEXT,
        approved_at      TEXT,
        consumed_at      TEXT,
        created_at       TEXT    NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_write_approvals_subject ON write_approvals (scope, subject_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS work_item_deployment_items (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id        TEXT    NOT NULL,
        temporary_id         TEXT    NOT NULL,
        work_item_type       TEXT,
        title                TEXT,
        ado_id               INTEGER,
        url                  TEXT,
        parent_temporary_id  TEXT,
        parent_ado_id        INTEGER,
        status               TEXT    NOT NULL,
        creation_status      TEXT    NOT NULL,
        verification_status  TEXT    NOT NULL,
        error_code           TEXT,
        error_message        TEXT,
        created_at           TEXT    NOT NULL,
        completed_at         TEXT,
        UNIQUE (deployment_id, temporary_id)
    )`
];
