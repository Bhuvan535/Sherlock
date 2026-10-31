import { getProjectContext } from '../azure-devops/context.js';
import { FIELD } from '../azure-devops/fields.js';
import { MINIMAL_WORK_ITEM_FIELDS } from '../azure-devops/field-profiles.js';
import { getSprintService } from '../azure-devops/sprint.service.js';
import { getTeamService } from '../azure-devops/team.service.js';
import { getWorkItemService } from '../azure-devops/work-item.service.js';
import { createLogger } from '../utils/logger.js';
import type { AssigneeCapacity, PlanningContext } from './types.js';

const log = createLogger('planning-context');

/**
 * Loads team membership, areas, iterations, states, existing titles, and
 * current-sprint capacity once. Individual rules must not call Azure DevOps.
 */
export async function buildPlanningContext(now: Date = new Date()): Promise<PlanningContext> {
    const team = getTeamService();
    const sprints = getSprintService();
    const workItems = getWorkItemService();
    const project = getProjectContext();

    const [members, configuration, iterations, stateCategories, existing, current] = await Promise.all([
        team.getMembers().catch(() => []),
        team.getTeamConfiguration().catch(() => null),
        sprints.getIterations().catch(() => []),
        project.getStateCategories().catch(() => new Map()),
        workItems
            .query([], {
                limit: 200,
                includeCompleted: false,
                profile: [...MINIMAL_WORK_ITEM_FIELDS, FIELD.areaPath]
            })
            .catch(error => {
                log.warn('Could not load existing work for duplicate checks', { error: String(error) });
                return [];
            }),
        sprints.getCurrentSprint().catch(() => null)
    ]);

    const statesByType: Record<string, string[]> = {};
    for (const [type, states] of stateCategories.entries()) {
        statesByType[type] = [...states.values()].map(state => state.name);
    }

    let capacity: AssigneeCapacity[] | null = null;
    let capacityAvailable = false;
    if (current) {
        const raw = await sprints.getCapacity(current).catch(() => null);
        if (raw && raw.length > 0) {
            const remaining = current.workingDaysRemaining ?? 5;
            capacity = raw.map(entry => ({
                assignee: entry.member,
                availableDays: Math.max(0, entry.capacityPerDay * remaining),
                assignedDays: 0
            }));
            capacityAvailable = true;
        }
    }

    return {
        now,
        members: members.map(m => ({ displayName: m.displayName, email: m.email })),
        areaPaths: (configuration?.areaPaths ?? []).map(entry => entry.path),
        defaultAreaPath: configuration?.defaultAreaPath ?? configuration?.areaPaths?.[0]?.path ?? null,
        iterations: iterations.map(it => ({
            name: it.name,
            path: it.path,
            startDate: it.startDate,
            finishDate: it.finishDate,
            timeFrame: it.timeFrame
        })),
        statesByType,
        existingWork: existing.map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            area: item.areaPath
        })),
        capacity,
        capacityAvailable
    };
}
