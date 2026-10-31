import { parseAdoDate, toDateOnly } from '../utils/dates.js';
import type { PlanningIteration } from './types.js';

export function datedSprints(iterations: PlanningIteration[]): PlanningIteration[] {
    return iterations.filter(
        it => it.timeFrame !== 'past' && parseAdoDate(it.startDate) && parseAdoDate(it.finishDate)
    );
}

export function dateOnly(value: string | null | undefined): string | null {
    const parsed = parseAdoDate(value ?? null);
    return parsed ? toDateOnly(parsed) : null;
}

export function pickSprintWindow(iterations: PlanningIteration[], count: number): PlanningIteration[] {
    const usable = datedSprints(iterations);
    if (usable.length === 0) return [];
    const currentIdx = Math.max(
        0,
        usable.findIndex(it => it.timeFrame === 'current')
    );
    return usable.slice(currentIdx, currentIdx + Math.max(1, count));
}

export function sprintDateRange(sprint: PlanningIteration): { start: string; end: string } | null {
    const start = dateOnly(sprint.startDate);
    const end = dateOnly(sprint.finishDate);
    if (!start || !end) return null;
    return { start, end };
}
