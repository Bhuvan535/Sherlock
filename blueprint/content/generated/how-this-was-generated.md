---
title: "How this site was generated"
description: "Trust and provenance"
---

This documentation site was produced by **Blueprint**, a CLI that inventories the git working tree and writes Markdown for [Astro Starlight](https://starlight.astro.build/).

- Local analysis is the source of truth (files, manifests, README, `docs/`).
- Optional LLM narration only receives that inventory; it must not invent modules or APIs.
- Pages under `blueprint/content/custom/` are never overwritten on re-run.
- Generated at 2026-09-02T07:17:37.506Z from `D:\Bhuvan\Kaar\K4K\Yeager`.