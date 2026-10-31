# Work Item Planner (V2 Phase 2)

The planner **designs** work. The Phase 1 [rule engine](planning-rules.md) **validates** it. Phase 3 [deployment](deployment.md) **creates** Azure DevOps work items after confirmation.

```text
requirement → search existing ADO work → WorkItemPlan → PlanningRuleEngine.validate
        → errors? fix / ask   warnings? show
        → user edits → full revalidation
        → stored VALID plan (not deployed)
```

## MCP tools

| Tool | Writes ADO? |
| --- | --- |
| `sherlock_plan_work` | No |
| `sherlock_get_work_plan` | No |
| `sherlock_modify_work_plan` | No |
| `sherlock_validate_work_item_plan` | No |

`sherlock_plan_work` searches existing titles first. A close User Story match is reported; it does not duplicate unless `forceNew` is true. A close Feature is reused (`existingAdoId`) with new stories underneath.

Edits are constrained (`revisions`: `set`, `add_task`, `remove`, `split_story`, `accept`). Every revision revalidates the **entire** plan.

## Persistence

SQLite `work_item_plans`: plan JSON, last validation, version, status (`DRAFT` / `VALID` / `INVALID` / `ACCEPTED` / `EXPIRED`), owner `SHERLOCK_USER_ID`, 7-day expiry.

Temporary IDs (`EPIC-1`, `US-1`, …) are used until Phase 3 creates real Azure DevOps IDs.

## What Phase 3 consumes

A stored `WorkItemPlan` (`planId`, `workItems`, `existingAdoId` where a parent already exists) with a fresh passing `PlanningRuleEngine` result. See [deployment.md](deployment.md).
