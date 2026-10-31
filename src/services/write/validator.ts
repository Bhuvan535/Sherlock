import { AppError } from '../../utils/errors.js';
import { parseAdoDate } from '../../utils/dates.js';
import { ALLOWED_CREATE_TYPES, type CreateWorkItemInput, type UpdateWorkItemChanges } from './types.js';
import { assertFieldForType } from './capabilities.js';

const TITLE_MAX = 255;
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 4;

export class WriteRequestValidator {
    validateCreate(input: CreateWorkItemInput): void {
        const type = input.workItemType?.trim();
        if (!type || !(ALLOWED_CREATE_TYPES as readonly string[]).includes(type)) {
            throw new AppError(
                'INVALID_INPUT',
                'workItemType must be Epic, Feature, User Story, Task, or Bug.',
                { hint: 'Create uses the controlled type list only. Delete is not available.' }
            );
        }
        this.assertTitle(input.title);
        if (input.priority !== undefined) this.assertPriority(input.priority);
        this.assertDates(input);
        if (input.parentId !== undefined && (!Number.isInteger(input.parentId) || input.parentId <= 0)) {
            throw new AppError('INVALID_INPUT', 'parentId must be a positive work-item id.');
        }
    }

    validateUpdate(workItemId: unknown, changes: UpdateWorkItemChanges | undefined): void {
        if (!Number.isInteger(workItemId) || (workItemId as number) <= 0) {
            throw new AppError('INVALID_INPUT', 'workItemId must be a positive integer.');
        }
        if (!changes || Object.values(changes).every(value => value === undefined)) {
            throw new AppError('INVALID_INPUT', 'At least one change is required.');
        }
        if (changes.title !== undefined) this.assertTitle(changes.title);
        if (changes.priority !== undefined) this.assertPriority(changes.priority);
        this.assertDates(changes);
    }

    assertUpdateFieldsForType(workItemType: string, changes: UpdateWorkItemChanges): void {
        for (const key of Object.keys(changes) as (keyof UpdateWorkItemChanges)[]) {
            if (changes[key] === undefined) continue;
            assertFieldForType(workItemType, String(key));
        }
    }

    normalizeTags(tags?: string[]): string[] {
        if (!tags) return [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of tags) {
            const tag = String(raw ?? '').trim();
            if (!tag) continue;
            const key = tag.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(tag);
        }
        return out;
    }

    assertStateAllowed(state: string, allowed: string[]): void {
        if (allowed.length === 0) return;
        if (!allowed.some(name => name.toLowerCase() === state.toLowerCase())) {
            throw new AppError('INVALID_INPUT', `State "${state}" is not valid for this work-item type.`, {
                hint: `Allowed states: ${allowed.join(', ')}.`
            });
        }
    }

    private assertTitle(title: string | undefined): void {
        const value = title?.trim() ?? '';
        if (value.length === 0) {
            throw new AppError('INVALID_INPUT', 'Title is required and cannot be empty.');
        }
        if (value.length > TITLE_MAX) {
            throw new AppError('INVALID_INPUT', `Title must be ${TITLE_MAX} characters or fewer.`);
        }
    }

    private assertPriority(priority: number): void {
        if (!Number.isInteger(priority) || priority < PRIORITY_MIN || priority > PRIORITY_MAX) {
            throw new AppError('INVALID_INPUT', `Priority must be an integer from ${PRIORITY_MIN} to ${PRIORITY_MAX}.`);
        }
    }

    private assertDates(input: {
        plannedStart?: string;
        plannedEnd?: string;
        actualStart?: string;
        actualEnd?: string;
    }): void {
        const start = this.parseOptionalDate(input.plannedStart, 'plannedStart');
        const end = this.parseOptionalDate(input.plannedEnd, 'plannedEnd');
        if (start && end && end < start) {
            throw new AppError('INVALID_INPUT', 'plannedEnd cannot be earlier than plannedStart.');
        }
        const actualStart = this.parseOptionalDate(input.actualStart, 'actualStart');
        const actualEnd = this.parseOptionalDate(input.actualEnd, 'actualEnd');
        if (actualStart && actualEnd && actualEnd < actualStart) {
            throw new AppError('INVALID_INPUT', 'actualEnd cannot be earlier than actualStart.');
        }
    }

    private parseOptionalDate(value: string | undefined, label: string): Date | null {
        if (value === undefined || value === '') return null;
        const parsed = parseAdoDate(value);
        if (!parsed) {
            throw new AppError('INVALID_INPUT', `${label} must be a valid ISO date or datetime.`);
        }
        return parsed;
    }
}
