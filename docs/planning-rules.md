# Planning rule engine

S.H.E.R.L.O.C.K. can **validate** a proposed work-item tree before anything is written to Azure DevOps.

See also [work-item-planner.md](work-item-planner.md) for proposing and editing a plan before Phase 3 deployment.

## MCP tool

`sherlock_validate_work_item_plan` accepts a `plan` object (`workItems`, optional `dependencies`). It loads Azure DevOps context once (members, area paths, iterations, states, existing titles, current-sprint capacity) and returns `valid`, `errors`, `warnings`, and `info`.

It is read-only. Confirmed writes remain `sherlock_prepare_*` / `sherlock_confirm_write` ([writes.md](writes.md)).

## Machine-readable catalog

Rules live in `rules/planning/catalog.json` (`ruleId`, `severity`, `appliesTo`, `description`). TypeScript validators in `src/planning/` apply them. Rules must not call Azure DevOps themselves.

## Hierarchy

Epic → Feature → User Story → Task. Epic has no parent. Feature/Story/Task parents are mandatory and must be the correct type.

## Hard errors (examples)

Missing title, description, assignee, area, iteration, state, priority, planned dates (except bugs skip planned-date rules). Invalid identity or paths. End before start. Actual dates on new items or in the future. Invalid hierarchy. Story without Feature, Task without Story, Feature without a Story, Story without a Task. Meaningless/status-only titles. Obvious duplicates. Bad dependencies.

## Warnings

Capacity missing or overload (user may accept overload). Possible duplicates. Ceremony placeholders. Over-decomposition. Unclear dependencies.

## Code

| Path | Role |
| --- | --- |
| `src/planning/engine.ts` | `validate` |
| `src/planning/checks.ts` | Rule implementations |
| `src/planning/context-builder.ts` | One-shot ADO read |
| `src/planning/types.ts` | Plan and result types |
