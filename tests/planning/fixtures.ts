import type { PlanningContext, WorkItemPlan } from '../../src/planning/types.js';

export const NOW = new Date('2026-09-08T09:00:00');

export function baseContext(overrides: Partial<PlanningContext> = {}): PlanningContext {
    return {
        now: NOW,
        members: [
            { displayName: 'Ada Lovelace', email: 'ada@example.com' },
            { displayName: 'Alan Turing', email: 'alan@example.com' }
        ],
        areaPaths: ['K4K\\Platform'],
        iterations: [
            {
                name: 'S31',
                path: 'K4K\\S31',
                startDate: '2026-08-18T00:00:00.000Z',
                finishDate: '2026-08-31T00:00:00.000Z',
                timeFrame: 'past'
            },
            {
                name: 'S32',
                path: 'K4K\\S32',
                startDate: '2026-09-01T00:00:00.000Z',
                finishDate: '2026-09-14T00:00:00.000Z',
                timeFrame: 'current'
            },
            {
                name: 'S33',
                path: 'K4K\\S33',
                startDate: '2026-09-15T00:00:00.000Z',
                finishDate: '2026-09-28T00:00:00.000Z',
                timeFrame: 'future'
            }
        ],
        statesByType: {
            Epic: ['New', 'Active', 'Closed'],
            Feature: ['New', 'Active', 'Closed'],
            'User Story': ['New', 'Active', 'Closed'],
            Task: ['New', 'Active', 'Closed'],
            Bug: ['New', 'Active', 'Closed']
        },
        existingWork: [{ id: 1001, title: 'Existing login module', type: 'User Story', area: 'K4K\\Platform' }],
        capacity: [{ assignee: 'Ada Lovelace', availableDays: 20, assignedDays: 0 }],
        capacityAvailable: true,
        ...overrides
    };
}

export function validPlan(): WorkItemPlan {
    return {
        planId: 'plan-1',
        workItems: [
            {
                temporaryId: 'e1',
                type: 'Epic',
                title: 'Customer onboarding journey',
                description: 'End-to-end onboarding.',
                assignedTo: 'Ada Lovelace',
                area: 'K4K\\Platform',
                iteration: 'S33',
                state: 'New',
                priority: 2,
                plannedStart: '2026-09-01',
                plannedEnd: '2026-09-20'
            },
            {
                temporaryId: 'f1',
                type: 'Feature',
                parentTemporaryId: 'e1',
                title: 'Account creation flow',
                description: 'Create and verify accounts.',
                assignedTo: 'Ada Lovelace',
                area: 'K4K\\Platform',
                iteration: 'S32',
                state: 'New',
                priority: 2,
                plannedStart: '2026-09-01',
                plannedEnd: '2026-09-14'
            },
            {
                temporaryId: 's1',
                type: 'User Story',
                parentTemporaryId: 'f1',
                title: 'As a user I can register with email',
                description: 'Email registration with verification.',
                assignedTo: 'Ada Lovelace',
                area: 'K4K\\Platform',
                iteration: 'S32',
                state: 'New',
                priority: 2,
                plannedStart: '2026-09-01',
                plannedEnd: '2026-09-10',
                acceptanceCriteria: ['User can submit email', 'Verification mail is sent']
            },
            {
                temporaryId: 't1',
                type: 'Task',
                parentTemporaryId: 's1',
                title: 'Build registration API endpoint',
                description: 'POST /register with validation.',
                assignedTo: 'Ada Lovelace',
                area: 'K4K\\Platform',
                iteration: 'S32',
                state: 'New',
                priority: 2,
                plannedStart: '2026-09-01',
                plannedEnd: '2026-09-05'
            }
        ]
    };
}
