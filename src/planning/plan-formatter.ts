import { parseAdoDate, toDateOnly } from '../utils/dates.js';
import type { PlannedWorkItem, WorkItemPlan } from './types.js';

export interface PlanFieldChange {
    temporaryId: string;
    title: string;
    field: string;
    from: string;
    to: string;
}

export function diffPlans(before: WorkItemPlan, after: WorkItemPlan): PlanFieldChange[] {
    const changes: PlanFieldChange[] = [];
    const beforeById = new Map(before.workItems.map(item => [item.temporaryId, item]));
    const afterIds = new Set(after.workItems.map(item => item.temporaryId));

    for (const item of after.workItems) {
        const prev = beforeById.get(item.temporaryId);
        if (!prev) {
            changes.push({
                temporaryId: item.temporaryId,
                title: item.title ?? item.temporaryId,
                field: 'added',
                from: '',
                to: `${item.type}: ${item.title ?? ''}`
            });
            continue;
        }
        for (const field of [
            'title',
            'assignedTo',
            'area',
            'iteration',
            'state',
            'priority',
            'plannedStart',
            'plannedEnd',
            'parentTemporaryId'
        ] as const) {
            const from = String(prev[field] ?? '');
            const to = String(item[field] ?? '');
            if (from !== to) {
                changes.push({
                    temporaryId: item.temporaryId,
                    title: item.title ?? item.temporaryId,
                    field,
                    from,
                    to
                });
            }
        }
    }
    for (const item of before.workItems) {
        if (afterIds.has(item.temporaryId)) continue;
        changes.push({
            temporaryId: item.temporaryId,
            title: item.title ?? item.temporaryId,
            field: 'removed',
            from: `${item.type}: ${item.title ?? ''}`,
            to: ''
        });
    }
    return changes;
}

export function formatPlanDiff(changes: PlanFieldChange[]): string {
    if (changes.length === 0) return 'No field changes.';
    return changes
        .map(change => `${change.title} (${change.temporaryId}): ${change.field}: ${change.from || '—'} → ${change.to || '—'}`)
        .join('\n');
}

export function formatDateShort(value: string | null | undefined): string {
    const parsed = parseAdoDate(value ?? null);
    return parsed ? toDateOnly(parsed) : value ?? '—';
}

export function formatPlanMarkdown(plan: WorkItemPlan): string {
    const roots = plan.workItems.filter(item => !item.parentTemporaryId);
    const lines: string[] = ['S.H.E.R.L.O.C.K. Work Item Plan', ''];
    if (plan.planId) lines.push(`Plan: ${plan.planId}  Version ${plan.version ?? 1}  Status: ${plan.status ?? 'DRAFT'}`);
    if (plan.summary) lines.push(plan.summary, '');
    for (const root of roots.length > 0 ? roots : plan.workItems.filter(i => i.type === 'Epic')) {
        renderNode(root, plan.workItems, lines, '');
    }
    if (plan.assumptions && plan.assumptions.length > 0) {
        lines.push('', 'Assumptions:');
        for (const assumption of plan.assumptions) lines.push(`- ${assumption}`);
    }
    lines.push('', 'The plan is not deployed.');
    return lines.join('\n');
}

function renderNode(item: PlannedWorkItem, all: PlannedWorkItem[], lines: string[], indent: string): void {
    lines.push(`${indent}${item.type}: ${item.title ?? item.temporaryId}`);
    lines.push(`${indent}  Iteration: ${item.iteration ?? '—'}`);
    lines.push(`${indent}  Planned: ${formatDateShort(item.plannedStart)} → ${formatDateShort(item.plannedEnd)}`);
    lines.push(`${indent}  Assigned To: ${item.assignedTo ?? '—'}`);
    if (item.area) lines.push(`${indent}  Area: ${item.area}`);
    const children = all.filter(child => child.parentTemporaryId === item.temporaryId);
    for (const child of children) renderNode(child, all, lines, `${indent}  `);
}
