---
title: "Reference"
description: "Scripts, CLIs, and environment variables"
---

Commands, scripts, and environment names found in manifests and README / `.env.example`.

## Scripts

| Name | Command |
| --- | --- |
| `build` | `tsc -p tsconfig.build.json` |
| `start` | `node dist/index.js` |
| `dev` | `tsx watch src/index.ts` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `test:security` | `vitest run tests/security` |
| `test:skills` | `vitest run tests/skills` |
| `inspector` | `mcp-inspector --config mcp-inspector.config.json --server sherlock` |
| `inspector:build` | `npm run build && mcp-inspector --config mcp-inspector.config.json --server sherlock-dist` |
| `doctor` | `tsx scripts/doctor.ts` |
| `verify:live` | `tsx scripts/verify-live.ts` |
| `verify:readonly` | `tsx scripts/verify-readonly.ts` |

## Environment variables

- `ADO_ORGANIZATION`
- `ADO_PAT`
- `ADO_PROJECT`
- `ADO_TEAM`
- `API`
- `LOG_LEVEL`
- `SHERLOCK_ENV`
- `TOKEN_DEBUG`
