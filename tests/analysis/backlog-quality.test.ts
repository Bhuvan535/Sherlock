import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../src/azure-devops/types.js';
import { analyseBacklog, buildRelationMaps } from '../../src/services/analysis/backlog/analyse.js';
import type { BacklogContext } from '../../src/services/analysis/backlog/types.js';
import { evaluateBacklogQuality } from '../../src/services/analysis/governance.service.js';

function item(partial: Partial<WorkItem> & Pick<WorkItem, 'id' | 'type' | 'title' | 'state'>): WorkItem {
    return {
        rev: 1,
        stateCategory: 'InProgress',
        reason: null,
        assignedTo: 'Arun Kumar',
        assignedToEmail: 'arun@kaartech.com',
        createdBy: 'Priya Menon',
        createdDate: new Date().toISOString(),
        changedBy: 'Arun Kumar',
        changedDate: new Date().toISOString(),
        closedDate: null,
        activatedDate: null,
        resolvedDate: null,
        stateChangeDate: null,
        startDate: null,
        dueDate: null,
        targetDate: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        iterationPath: 'K4K\\Sprint 12',
        areaPath: 'K4K\\Platform',
        priority: 2,
        severity: null,
        tags: [],
        storyPoints: null,
        effort: null,
        originalEstimate: null,
        remainingWork: null,
        completedWork: null,
        parentId: null,
        blockedField: null,
        url: null,
        webUrl: `https://dev.azure.com/KEBS4KAAR/K4K/_workitems/edit/${partial.id}`,
        relations: [],
        description: 'A reasonably complete description of the work that needs to be done.',
        acceptanceCriteria: 'Given when then',
        reproSteps: null,
        valueArea: null,
        risk: null,
        businessValue: null,
        activity: null,
        extraFields: {},
        ...partial
    };
}

function ctx(items: WorkItem[], extra: Partial<BacklogContext> = {}): BacklogContext {
    const maps = buildRelationMaps(items);
    return {
        items,
        byId: maps.byId,
        childrenOf: maps.childrenOf,
        parentOf: maps.parentOf,
        teamMemberNames: new Set(['Arun Kumar', 'Priya Menon']),
        teamAreaHints: ['Platform', 'K4K'],
        currentSprintPath: 'K4K\\Sprint 12',
        currentSprintStart: null,
        currentSprintEnd: null,
        iterations: [],
        now: new Date(),
        truncated: false,
        scannedLimit: 500,
        fields: {
            plannedStart: true,
            plannedEnd: true,
            actualStart: true,
            actualEnd: true,
            description: true,
            acceptanceCriteria: true,
            estimate: true,
            remainingWork: true,
            severity: true,
            risk: true
        },
        workItemTypes: ['Epic', 'Feature', 'User Story', 'Task', 'Bug'],
        ...extra
    };
}

describe('backlog governance analyser', () => {
    it('flags closed stories without child tasks and counts the category', () => {
        const story = item({
            id: 1,
            type: 'User Story',
            title: 'Closed story without any implementation tasks',
            state: 'Closed',
            stateCategory: 'Completed',
            parentId: 10
        });
        const result = analyseBacklog(ctx([story]));
        const cat = result.categories.find(c => c.category === 'Closed Stories Without Tasks');
        expect(cat?.count).toBe(1);
        expect(cat?.createQuery).toBe(false);
    });

    it('sets createQuery when a category exceeds three items', () => {
        const stories = [1, 2, 3, 4].map(id =>
            item({
                id,
                type: 'Task',
                title: `Orphan implementation task number ${id}`,
                state: 'Active',
                stateCategory: 'InProgress',
                parentId: null
            })
        );
        const result = analyseBacklog(ctx(stories));
        const cat = result.categories.find(c => c.category === 'Orphan Task');
        expect(cat?.count).toBe(4);
        expect(cat?.createQuery).toBe(true);
        expect(cat?.queryName).toBe('Orphan Task');
        expect(result.queryHints.some(h => h.queryName === 'Orphan Task')).toBe(true);
    });

    it('does not flag an active story that has Hierarchy-Forward children even if those tasks were not loaded', () => {
        const story = item({
            id: 5290,
            type: 'User Story',
            title: 'As an engineer, I want to define the high-level centralized authentication architecture',
            state: 'Active',
            stateCategory: 'InProgress',
            relations: [
                {
                    rel: 'System.LinkTypes.Hierarchy-Forward',
                    url: 'https://dev.azure.com/KEBS4KAAR/_apis/wit/workItems/5291',
                    attributes: { name: 'Child' }
                }
            ]
        });
        const result = analyseBacklog(ctx([story]));
        expect(result.categories.some(c => c.category === 'Active Stories Without Tasks')).toBe(false);
    });

    it('does not treat a New story without tasks as a closed-story fault', () => {
        const story = item({
            id: 5,
            type: 'User Story',
            title: 'Newly created story still being refined with the team',
            state: 'New',
            stateCategory: 'Proposed',
            parentId: 10
        });
        const issues = evaluateBacklogQuality(story, []);
        expect(issues.some(i => i.issue.includes('Completed User Story'))).toBe(false);
    });

    it('flags invalid planned date sequence', () => {
        const task = item({
            id: 6,
            type: 'Task',
            title: 'Task with inverted planned dates for the sprint',
            state: 'Active',
            parentId: 50,
            plannedStart: '2026-08-20T00:00:00Z',
            plannedEnd: '2026-08-01T00:00:00Z'
        });
        const result = analyseBacklog(ctx([task]));
        expect(result.categories.some(c => c.category === 'Invalid Planned Dates')).toBe(true);
    });

    const teamSprints = [
        {
            name: 'S10-Aug FY27',
            path: 'K4K\\Platform\\S10-Aug FY27',
            startDate: new Date('2026-08-16T00:00:00Z'),
            finishDate: new Date('2026-08-30T00:00:00Z'),
            timeFrame: 'past' as const
        },
        {
            name: 'S11-Sept FY27',
            path: 'K4K\\Platform\\S11-Sept FY27',
            startDate: new Date('2026-08-31T00:00:00Z'),
            finishDate: new Date('2026-09-15T00:00:00Z'),
            timeFrame: 'current' as const
        },
        {
            name: 'S12-Sept FY27',
            path: 'K4K\\Platform\\S12-Sept FY27',
            startDate: new Date('2026-09-16T00:00:00Z'),
            finishDate: new Date('2026-09-30T00:00:00Z'),
            timeFrame: 'future' as const
        }
    ];

    it('flags stories, tasks and bugs on the team backlog, but not epics or features', () => {
        const feature = item({
            id: 3171,
            type: 'Feature',
            title: 'KAFY - DMS delivery feature spanning several sprints',
            state: 'New',
            stateCategory: 'Proposed',
            iterationPath: 'K4K\\Platform'
        });
        const story = item({
            id: 3172,
            type: 'User Story',
            title: 'As a user I can upload a document in the DMS',
            state: 'New',
            stateCategory: 'Proposed',
            iterationPath: 'K4K\\Platform',
            parentId: 3171
        });
        const result = analyseBacklog(
            ctx([feature, story], {
                currentSprintPath: 'K4K\\Platform\\S11-Sept FY27',
                iterations: teamSprints
            })
        );
        expect(result.categories.some(c => c.category === 'Not Assigned To A Sprint' && c.itemIds.includes(3171))).toBe(
            false
        );
        const cat = result.categories.find(c => c.category === 'Not Assigned To A Sprint');
        expect(cat?.itemIds).toContain(3172);
    });

    it('flags open work left on a past sprint using iteration dates', () => {
        const task = item({
            id: 4001,
            type: 'Task',
            title: 'Finish leftover implementation work from the previous sprint',
            state: 'Active',
            iterationPath: 'K4K\\Platform\\S10-Aug FY27',
            parentId: 50
        });
        const result = analyseBacklog(
            ctx([task], {
                currentSprintPath: 'K4K\\Platform\\S11-Sept FY27',
                iterations: teamSprints,
                now: new Date('2026-09-03T00:00:00Z')
            })
        );
        expect(result.categories.some(c => c.category === 'Open Work In Past Sprint')).toBe(true);
    });

    it('does not require a current-sprint story to be flagged as missing a sprint', () => {
        const story = item({
            id: 4002,
            type: 'User Story',
            title: 'Story committed to the current sprint with a parent feature',
            state: 'Active',
            iterationPath: 'K4K\\Platform\\S11-Sept FY27',
            parentId: 10
        });
        const result = analyseBacklog(
            ctx([story], {
                currentSprintPath: 'K4K\\Platform\\S11-Sept FY27',
                iterations: teamSprints
            })
        );
        expect(result.categories.some(c => c.category === 'Not Assigned To A Sprint')).toBe(false);
        expect(result.categories.some(c => c.category === 'Open Work In Past Sprint')).toBe(false);
    });
});
