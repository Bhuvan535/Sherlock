import { parseAdoDate, startOfDay } from '../utils/dates.js';
import type { PlannedWorkItem, PlanningContext, PlanningIteration } from './types.js';

export function blank(value: unknown): boolean {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.every(item => blank(item));
    return false;
}

export function asText(value: unknown): string {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join('\n');
    return String(value ?? '').trim();
}

export function normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function tokenOverlap(a: string, b: string): number {
    const left = new Set(normalizeTitle(a).split(' ').filter(t => t.length > 2));
    const right = new Set(normalizeTitle(b).split(' ').filter(t => t.length > 2));
    if (left.size === 0 || right.size === 0) return 0;
    let hit = 0;
    for (const t of left) if (right.has(t)) hit += 1;
    return hit / Math.max(left.size, right.size);
}

export function resolveMember(name: string, context: PlanningContext): boolean {
    const needle = name.trim().toLowerCase();
    return context.members.some(
        m =>
            m.displayName.toLowerCase() === needle ||
            (m.email ?? '').toLowerCase() === needle ||
            m.displayName.toLowerCase().includes(needle)
    );
}

export function resolveIteration(value: string, context: PlanningContext): PlanningIteration | undefined {
    const needle = value.trim().toLowerCase();
    return context.iterations.find(
        it => it.path.toLowerCase() === needle || it.name.toLowerCase() === needle
    );
}

export function areaAllowed(path: string, context: PlanningContext): boolean {
    if (context.areaPaths.length === 0) return true;
    return context.areaPaths.some(
        area => path === area || path.startsWith(`${area}\\`) || area.startsWith(`${path}\\`)
    );
}

export function statesFor(type: string, context: PlanningContext): string[] {
    return context.statesByType[type] ?? context.statesByType['*'] ?? [];
}

export function byId(items: PlannedWorkItem[]): Map<string, PlannedWorkItem> {
    return new Map(items.map(item => [item.temporaryId, item]));
}

export function childrenOf(parentId: string, items: PlannedWorkItem[]): PlannedWorkItem[] {
    return items.filter(item => item.parentTemporaryId === parentId);
}

const STATUS_TITLES = new Set([
    'development',
    'implementation',
    'testing',
    'deployment',
    'discussion',
    'authentication',
    'database work',
    'moved to prd',
    'testing in non-prd',
    'ready for release',
    'qa',
    'qa/validation',
    'validation'
]);

const CEREMONY = /\b(standup|stand-up|retro|retrospective|grooming|refinement|ceremony|meeting|status update)\b/i;

export function isMeaninglessTitle(title: string): boolean {
    return STATUS_TITLES.has(normalizeTitle(title));
}

export function isCeremonyTitle(title: string): boolean {
    return CEREMONY.test(title);
}

export function dateOf(value: string | null | undefined): Date | null {
    return parseAdoDate(value ?? null);
}

export function expectedEndIteration(item: PlannedWorkItem, context: PlanningContext): PlanningIteration | undefined {
    const end = dateOf(item.plannedEnd);
    if (!end) return undefined;
    const day = startOfDay(end);
    return context.iterations.find(it => {
        const start = dateOf(it.startDate);
        const finish = dateOf(it.finishDate);
        if (!start || !finish) return false;
        return day >= startOfDay(start) && day <= startOfDay(finish);
    });
}
