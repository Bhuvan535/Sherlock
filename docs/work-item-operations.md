# Work-item operations (Phase 4)

All Azure DevOps mutations go through **one** gateway: `WorkItemOperationService`, and every one of them is gated on an approval the user gave after seeing what would change.

```text
User request
  → understand → search existing work
  → proposed plan / proposed changes
  → PlanningRuleEngine
  → proposal shown to the user        (AWAITING_CONFIRMATION, nothing written)
  → user reviews / modifies
  → explicit user confirmation        (APPROVED)
  → final validation
  → WorkItemOperationService → AzureDevOpsWriteClient → Azure DevOps
  → verification → result + navigation links
```

There is no path from a request straight to a write. The model cannot supply REST URLs, HTTP methods, JSON Patch, arbitrary relation types, or delete.

## The approval gate

The write layer trusts an **approved operation**, never the model's stated intention. A tool call is not approval; a generated plan is not approval; the user's original request ("create work items for Blueprint") is not approval.

Three facts must all hold before Azure DevOps is mutated, and they are checked independently:

| Fact | Where it is enforced |
| --- | --- |
| The proposal was rendered and returned to the client | `markPresented` runs in the tool registry after the preview is serialised; `assertPresented` blocks confirmation otherwise |
| An explicit confirmation claimed that exact token | `WriteApprovalManager.claim` / `DeploymentApprovalManager.claim`, the only transitions to `APPROVED` |
| The mutation runs inside the approved operation | `runAuthorizedWrite` wraps execution; `assertWriteAuthorized` in `AzureDevOpsWriteClient` throws `WRITE_NOT_AUTHORIZED` for anything else |

The third check is the backstop: any future code that reaches `createWorkItem`, `updateWorkItem`, or `addWorkItemComment` without an approved operation in scope fails loudly rather than writing.

### States

Plans: `DRAFT → VALID → AWAITING_CONFIRMATION → APPROVED → DEPLOYING → COMPLETED`, with `INVALID`, `EXPIRED`, `PARTIALLY_COMPLETED` and `FAILED` as terminal alternatives. Single operations use `PREPARED → AWAITING_CONFIRMATION → APPROVED → EXECUTING → COMPLETED`. Preparing a deployment moves a plan to `AWAITING_CONFIRMATION`, never to `APPROVED`.

### Confirmation binding

A deployment confirmation is bound to `planId`, `planVersion`, and a content hash of the plan's work items and dependencies. `sherlock_modify_work_plan` supersedes outstanding approvals, and confirming a superseded, re-versioned, or re-hashed plan is rejected — prepare again and have the user approve the new version. Tokens expire after eight minutes and cannot be replayed.

`sherlock_retry_deployment` resumes work the user already approved. It reads the recorded approval for that deployment and refuses if none exists or if the plan changed since approval.

Approval evidence lives in the `write_approvals` table: which proposal, when it was shown, when it was approved, and when it was consumed. No credentials are recorded.

## Supported types

Epic, Feature, User Story, Task, Bug — **only if the configured project process actually defines them**. Sherlock does not invent types.

Fields are gated by a type capability map plus ADO field mapping (custom planned/actual dates). Reproduction steps are Bug-only; acceptance criteria is Story/Feature/Bug.

## Create

`sherlock_prepare_create_work_item` then `sherlock_confirm_write`.

- Feature requires an Epic `parentId`.
- Hierarchy when a parent is set: Epic → Feature → User Story → Task. Bug under Story or Feature.
- Optional: description, assignee, area, iteration, state, priority, tags, planned/actual dates, acceptance criteria, reproduction steps.

## Update

`sherlock_prepare_update_work_item` with listed fields only. Tags: `addTags`, `removeTags`, or `replaceTags`. Revision `/rev` test on confirm.

## Relationships

`sherlock_prepare_relationship_change`:

| action | meaning |
| --- | --- |
| `set_parent` | Hierarchy-Reverse only |
| `remove_parent` | Allowed except Feature (must stay under Epic) |
| `add_predecessor` | Dependency-Reverse only |
| `remove_predecessor` | Removes that predecessor only |

`sherlock_prepare_set_parent` remains as a convenience wrapper for `set_parent`.

Self-links, missing ids, illegal types, and detectable cycles are blocked.

## Comments

`sherlock_prepare_add_comment` then confirm. Posts to the work-item comments API. Comments are never added as a side effect of analysis.

## Confirmation, idempotency, retry, status

- Prepare tools do not write.
- `sherlock_confirm_write` executes. Replaying a **successful** confirmation returns the previous result (no duplicate create).
- Failed confirms stay retryable (`sherlock_retry_write` or confirm again). Successful items are not rewritten.
- `sherlock_get_write_status` reads SQLite + in-memory confirmation state.
- Tokens expire in 8 minutes if unused. They belong to `SHERLOCK_USER_ID`.

## Validation

- Assignee must match a team member.
- Area and iteration must exist for the team.
- State must be a real process state for that type (not invented names such as QA).
- Priority 1–4. Planned end cannot precede planned start. Actual dates are facts; Sherlock does not fabricate them.
- Planning-related field changes also run `PlanningRuleEngine`; blocking rule ids fail prepare. Other plan-quality errors are shown as warnings.

## Creation vs verification

```json
{ "creationStatus": "SUCCESS", "verificationStatus": "FAILED" }
```

or `updateStatus` for updates. If ADO accepted the write, do **not** repeat a create.

Verification uses batch GET (`getByIds`). Single-item GET never combines `$expand` and `fields`.

## Partial failure and retry (multi-item)

Phase 3 deployment still reports per-item COMPLETED / PARTIALLY_COMPLETED / FAILED and retries only failed items. Direct writes are one confirmation = one ADO mutation.

## Cache and navigation

After a successful mutation, work-item and snapshot cache prefixes are dropped. Responses include NavigationEngine work-item URLs.

## Audit

Prepare/confirm tools write `tl_activity` and `write_operations`. PAT and tokens are never stored.

## Security restrictions

No delete tool. No model-supplied patch, URL, method, or relation type. Credentials come only from Sherlock config.

## MCP tools

| Tool | Mutates ADO? |
| --- | --- |
| `sherlock_prepare_create_work_item` | No |
| `sherlock_prepare_update_work_item` | No |
| `sherlock_prepare_set_parent` | No |
| `sherlock_prepare_relationship_change` | No |
| `sherlock_prepare_add_comment` | No |
| `sherlock_get_write_status` | No |
| `sherlock_confirm_write` | Yes |
| `sherlock_retry_write` | Yes if the write had not succeeded |

## Examples

Prepare an update:

```json
{
  "workItemId": 6037,
  "assignedTo": "user@example.com",
  "iterationPath": "K4K\\Sprint 13",
  "priority": 2
}
```

Then `sherlock_confirm_write` with the returned `WRITE-…` id.

## Known limitations

- No work-item delete.
- Related/duplicate links are not writable.
- Successor is implied by adding a predecessor on the waiting item.
- Multi-item transactional writes are not offered on the direct write tools (use deployment for trees).
- Comment HTML is sent as the provided text; ADO may store it as HTML.

See also [writes.md](writes.md) and [deployment.md](deployment.md).
