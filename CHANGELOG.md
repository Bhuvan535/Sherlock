# Changelog

## 2.0.0-phase4.1

- Enforced the plan → review → confirmation → write workflow in code for every Azure DevOps mutation.
- `assertWriteAuthorized` at the Azure DevOps write client boundary: create, update and comment now throw `WRITE_NOT_AUTHORIZED` outside an approved, user-confirmed operation.
- Preparing a deployment moves a plan to `AWAITING_CONFIRMATION` instead of `APPROVED`; only an explicit confirmation approves it.
- Deployment confirmations are bound to plan id, version and content hash. Modifying a plan supersedes outstanding approvals.
- Confirmation requires the proposal to have actually been presented to the client.
- `sherlock_retry_deployment` requires a recorded approval for an unchanged plan.
- New `write_approvals` audit table records presentation, approval and consumption (schema version 5).

## 2.0.0-phase4

- Unified work-item mutations through `WorkItemOperationService` (create, update, relations, comments, Phase 3 deploy).
- Create/update for Epic, Feature, User Story, Task, and Bug with process type and field capability checks.
- Hierarchy and predecessor tools, confirmed comments, write status, retry without duplicating successes.
- Creation/update vs verification statuses; cache invalidation after writes.

## 2.0.0-phase3

- Added confirmed plan deployment: `sherlock_prepare_deployment`, `sherlock_confirm_deployment`, `sherlock_get_deployment_status`, `sherlock_retry_deployment`.
- Creates Epic/Feature/User Story/Task with parent links from a stored valid plan. Partial failures are retained; retry skips successes.

## 2.0.0-phase2

- Added the Work Item Planner: `sherlock_plan_work`, `sherlock_get_work_plan`, `sherlock_modify_work_plan`.
- Plans are validated by the Phase 1 rule engine, stored in SQLite, and never deployed to Azure DevOps.

## 2.0.0-phase1

- Added confirmed Azure DevOps work-item writes: Task/User Story create and listed field updates.
- New tools: `sherlock_prepare_create_work_item`, `sherlock_prepare_update_work_item`, `sherlock_confirm_write`.
- Writes use an internal JSON Patch, revision test, 8-minute confirmation, and `write_operations` audit rows.
- Analysis skills and the V1 read path are unchanged. Delete is not available.

## 1.0.0

- Renamed public product identity to S.H.E.R.L.O.C.K.
- Centralized required Azure DevOps configuration.
- Added S.H.E.R.L.O.C.K. health check and `npm run doctor`.
- Removed email functionality from the V1 executable MCP surface.
- Kept Azure DevOps work items read-only with controlled saved-query creation.
- Changed generated saved-query storage to `My Queries/{ADO_TEAM}`.
- Added public installation, configuration, security, skills, MCP client and troubleshooting docs.
- Expanded Git documentation: per-client MCP setup (Claude Desktop, Claude Code, Claude CLI, Cursor, Kiro, Inspector), architecture diagrams, and a documentation index under `docs/`.

Future V2 candidates include email workflows and non-Azure DevOps platform adapters.
