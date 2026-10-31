# Security

S.H.E.R.L.O.C.K. analysis is **Azure DevOps work-item read-only** except for **confirmed** writes documented in [work-item-operations.md](work-item-operations.md). Delete and arbitrary PATCH remain forbidden.

That wording is intentional. The server is not “completely read-only” because it can create or reuse saved Boards queries.

## Forbidden

The server must not, and the tool surface is audited so it cannot:

- delete work items
- arbitrary / unlisted field mutation
- comments, bulk update, or JSON Patch supplied by the model (comments exist only as `sherlock_prepare_add_comment` + confirm)
- modify backlogs, sprints, repos, pipelines, or permissions
- execute a write without `sherlock_confirm_write`
- execute any Azure DevOps mutation without an approved operation in scope

When a user asks for an unsupported mutation, refuse it. For supported field changes, prepare then confirm.

## The approval boundary

The security boundary for writes is the code, not the model instruction. Every mutation must be a proposal that was rendered for the user and then explicitly confirmed; `assertWriteAuthorized` runs immediately before each Azure DevOps create, update and comment and throws `WRITE_NOT_AUTHORIZED` if no approved operation is in scope. Confirmations are bound to plan id, version and content hash, expire after eight minutes, and cannot be replayed. See [work-item-operations.md](work-item-operations.md) for the state machine and the `write_approvals` audit trail.

## Allowed

- Read Azure DevOps project, team, sprint, and work-item data
- Execute SELECT-only WIQL (POST to the WIQL endpoint is an Azure DevOps **read** API)
- Create or reuse saved queries under `My Queries/{ADO_TEAM}`
- Run analysis and recommendations
- Validate a proposed work-item plan (`sherlock_validate_work_item_plan`) without writing
- Propose and edit a stored plan (`sherlock_plan_work`, `sherlock_get_work_plan`, `sherlock_modify_work_plan`) without writing
- Manage **local** custom skills in SQLite
- Record redacted audit rows

Registered MCP tools with `readOnly: false` are `create_ado_query`, `sherlock_confirm_write`, `sherlock_retry_write`, `sherlock_confirm_deployment`, and `sherlock_retry_deployment`.

## PAT handling

| Rule | Detail |
| --- | --- |
| Source | `.env` or process env (`ADO_PAT`) |
| Logs | Redacted |
| MCP responses | Redacted |
| Errors | Redacted |
| SQLite | Not stored |
| Telemetry | Counts only, no token |
| Health / doctor | “PAT configured”, never the value |
| Query names | Must not include the PAT |

`src/utils/redact.ts` masks known secrets and credential-shaped strings.

Never paste a live PAT into README, issues, chat, or committed MCP JSON.

## Minimum PAT scopes (from actual usage)

Do not grant organization-wide Full Access.

Observed API usage:

| Capability | Why | Suggested PAT area |
| --- | --- | --- |
| Projects, teams, members, iterations, backlogs | Reads | **Project and Team: Read** |
| Work items, comments, updates, relations | Reads | **Work Items: Read** |
| WIQL | Read query | **Work Items: Read** |
| Saved query GET/POST under My Queries | Controlled write | **Work Items: Read & write** (or the Query permission your org uses for saving queries in My Queries) |

If you only want analysis and never saved queries, a **read-only** work-item PAT is enough; `create_ado_query` and skill query creation will fail with a permission error.

This document does not invent extra scopes (Analytics, Graph, Code, Pipelines) that V1 does not call.

## Local data

- Default DB: `data/sherlock.sqlite`
- Audit summaries are truncated and redacted
- Custom skill JSON is module lists and flags, not credentials
- `.gitignore` excludes `.env`, `data/`, `*.sqlite`, `dist/`, `node_modules/`, logs, coverage

## Git history

If a PAT was ever committed, **do not** rewrite history from this guide automatically. Rotate the PAT in Azure DevOps and treat the old token as compromised.

## Email

V1 has **no** email tools, Graph credentials, or send path. Email is a possible V2 feature only ([CHANGELOG.md](../CHANGELOG.md) / README roadmap).
