import { startOfDay } from '../../../utils/dates.js';
import type { IterationRef } from './types.js';
import { typeKind } from './classify.js';

/** Stories, tasks, bugs and issues belong in a dated sprint. Epics and Features do not. */
export function requiresSprintAssignment(type: string): boolean {
    const kind = typeKind(type);
    return kind === 'story' || kind === 'task' || kind === 'bug' || kind === 'issue';
}

export function looksLikeSprintName(name: string): boolean {
    const leaf = name.split('\\').pop()?.trim() ?? '';
    return /^s\d+/i.test(leaf) || /sprint\s*\d+/i.test(leaf);
}

export function matchIteration(path: string | null, iterations: IterationRef[]): IterationRef | undefined {
    if (!path) return undefined;
    const exact = iterations.find(it => it.path === path);
    if (exact) return exact;
    return iterations
        .filter(it => path === it.path || path.startsWith(`${it.path}\\`))
        .sort((a, b) => b.path.length - a.path.length)[0];
}

export function isDatedSprint(iteration: IterationRef | undefined): boolean {
    if (!iteration) return false;
    if (iteration.startDate && iteration.finishDate) return true;
    return looksLikeSprintName(iteration.name) || looksLikeSprintName(iteration.path);
}

export function isAssignedToSprint(
    path: string | null,
    iterations: IterationRef[],
    currentSprintPath: string | null
): boolean {
    if (!path) return false;
    const matched = matchIteration(path, iterations);
    if (matched) return isDatedSprint(matched);
    if (looksLikeSprintName(path)) return true;
    if (currentSprintPath && (path === currentSprintPath || path.startsWith(`${currentSprintPath}\\`))) {
        return true;
    }
    return false;
}

export function isPastSprint(iteration: IterationRef, now: Date): boolean {
    if (iteration.timeFrame === 'past') return true;
    if (iteration.timeFrame === 'current' || iteration.timeFrame === 'future') return false;
    if (iteration.finishDate) return startOfDay(iteration.finishDate) < startOfDay(now);
    return false;
}

export function isFutureSprint(iteration: IterationRef, now: Date): boolean {
    if (iteration.timeFrame === 'future') return true;
    if (iteration.timeFrame === 'current' || iteration.timeFrame === 'past') return false;
    if (iteration.startDate) return startOfDay(now) < startOfDay(iteration.startDate);
    return false;
}
