import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';
import type { RuleDefinition } from './types.js';

let cached: RuleDefinition[] | null = null;

export function loadRuleCatalog(): RuleDefinition[] {
    if (cached) return cached;
    const path = resolve(PROJECT_ROOT, 'rules/planning/catalog.json');
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { rules: RuleDefinition[] };
    cached = parsed.rules;
    return cached;
}

export function getRule(ruleId: string): RuleDefinition | undefined {
    return loadRuleCatalog().find(rule => rule.ruleId === ruleId);
}

export function resetRuleCatalogCache(): void {
    cached = null;
}
