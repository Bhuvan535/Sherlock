---
title: "Getting started"
description: "How to install and run sherlock-mcp"
---

## Node.js
Install dependencies with `npm install` (or pnpm/yarn if the repo uses them).
### Scripts
- `npm run build` — `tsc -p tsconfig.build.json`
- `npm run start` — `node dist/index.js`
- `npm run dev` — `tsx watch src/index.ts`
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — `vitest run`
- `npm run test:watch` — `vitest`
- `npm run test:security` — `vitest run tests/security`
- `npm run test:skills` — `vitest run tests/skills`
- `npm run inspector` — `mcp-inspector --config mcp-inspector.config.json --server sherlock`
- `npm run inspector:build` — `npm run build && mcp-inspector --config mcp-inspector.config.json --server sherlock-dist`
- `npm run doctor` — `tsx scripts/doctor.ts`
- `npm run verify:live` — `tsx scripts/verify-live.ts`
- `npm run verify:readonly` — `tsx scripts/verify-readonly.ts`
### CLI binaries
- `sherlock` → `dist/index.js`