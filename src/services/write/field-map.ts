import { FIELD } from '../../azure-devops/fields.js';
import type { CanonicalFieldMap } from '../../azure-devops/field-mapping.js';

const STATIC_MAP: Record<string, string> = {
    title: FIELD.title,
    description: FIELD.description,
    state: FIELD.state,
    assignedTo: FIELD.assignedTo,
    priority: FIELD.priority,
    iterationPath: FIELD.iterationPath,
    areaPath: FIELD.areaPath,
    tags: FIELD.tags,
    acceptanceCriteria: FIELD.acceptanceCriteria,
    reproductionSteps: FIELD.reproSteps
};

function typeKey(workItemType?: string): 'user story' | 'task' | 'feature' | 'epic' | 'other' {
    const t = (workItemType ?? '').trim().toLowerCase();
    if (t === 'user story' || t === 'userstory') return 'user story';
    if (t === 'task') return 'task';
    if (t === 'feature') return 'feature';
    if (t === 'epic') return 'epic';
    return 'other';
}

function pickPreferred(candidates: string[], preferred: string[]): string | null {
    for (const want of preferred) {
        const found = candidates.find(c => c.toLowerCase() === want.toLowerCase());
        if (found) return found;
    }
    const withoutClosed = candidates.find(c => !/closeddate$/i.test(c));
    return withoutClosed ?? candidates[0] ?? null;
}

export function resolveWriteField(
    logical: string,
    dates: CanonicalFieldMap,
    workItemType?: string
): string | null {
    if (STATIC_MAP[logical]) return STATIC_MAP[logical];

    const kind = typeKey(workItemType);
    if (logical === 'plannedStart') {
        if (kind === 'user story') return pickPreferred(dates.plannedStart, ['Custom.UserStoryPlannedStartDate']);
        if (kind === 'task') {
            return pickPreferred(dates.plannedStart, ['Custom.TaskPannedStartDate', 'Custom.TaskPlannedStartDate']);
        }
        if (kind === 'feature') return pickPreferred(dates.plannedStart, ['Custom.FeaturePlannedStartDate']);
        if (kind === 'epic') return pickPreferred(dates.plannedStart, []) ?? FIELD.startDate;
        return pickPreferred(dates.plannedStart, []) ?? FIELD.startDate;
    }
    if (logical === 'plannedEnd') {
        if (kind === 'user story') return pickPreferred(dates.plannedEnd, ['Custom.UserStoryPlannedEndDate']);
        if (kind === 'task') return pickPreferred(dates.plannedEnd, ['Custom.TaskPlannedEndDate']);
        if (kind === 'feature') return pickPreferred(dates.plannedEnd, ['Custom.FeaturePlannedEndDate']);
        if (kind === 'epic') return pickPreferred(dates.plannedEnd, []) ?? FIELD.targetDate;
        return pickPreferred(dates.plannedEnd, []) ?? FIELD.targetDate;
    }
    if (logical === 'actualStart') {
        if (kind === 'user story') return pickPreferred(dates.actualStart, ['Custom.UserStoryActualStartDate']);
        if (kind === 'task') return pickPreferred(dates.actualStart, ['Custom.TaskActualStartDate']);
        if (kind === 'feature') return pickPreferred(dates.actualStart, ['Custom.FeatureActualStartDate']);
        return pickPreferred(dates.actualStart, []);
    }
    if (logical === 'actualEnd') {
        if (kind === 'user story') return pickPreferred(dates.actualEnd, ['Custom.UserStoryActualEndDate']);
        if (kind === 'task') return pickPreferred(dates.actualEnd, ['Custom.TaskActualEndDate']);
        if (kind === 'feature') return pickPreferred(dates.actualEnd, ['Custom.FeatureActualEndDate']);
        return pickPreferred(dates.actualEnd, []);
    }
    return null;
}

export function dateLogicalNames(): Array<'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'> {
    return ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'];
}
