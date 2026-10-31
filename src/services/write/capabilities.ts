import { AppError } from '../../utils/errors.js';
import { getProjectContext } from '../../azure-devops/context.js';
import { ALLOWED_CREATE_TYPES } from './types.js';

const CORE_FIELDS = [
    'title',
    'description',
    'assignedTo',
    'areaPath',
    'iterationPath',
    'state',
    'priority',
    'plannedStart',
    'plannedEnd',
    'actualStart',
    'actualEnd',
    'tags',
    'addTags',
    'removeTags',
    'replaceTags'
] as const;

const TYPE_FIELDS: Record<string, ReadonlySet<string>> = {
    Epic: new Set([...CORE_FIELDS]),
    Feature: new Set([...CORE_FIELDS, 'parent', 'acceptanceCriteria']),
    'User Story': new Set([...CORE_FIELDS, 'parent', 'acceptanceCriteria']),
    Task: new Set([...CORE_FIELDS, 'parent']),
    Bug: new Set([...CORE_FIELDS, 'parent', 'acceptanceCriteria', 'reproductionSteps'])
};

export function fieldsForType(workItemType: string): ReadonlySet<string> {
    return TYPE_FIELDS[workItemType] ?? new Set(CORE_FIELDS);
}

export function assertFieldForType(workItemType: string, field: string): void {
    const allowed = fieldsForType(workItemType);
    if (!allowed.has(field)) {
        throw new AppError(
            'INVALID_INPUT',
            `Field "${field}" is not supported for ${workItemType} in the Sherlock write model.`
        );
    }
}

export async function assertTypeAvailable(workItemType: string): Promise<void> {
    const type = workItemType.trim();
    if (!(ALLOWED_CREATE_TYPES as readonly string[]).includes(type)) {
        throw new AppError(
            'INVALID_INPUT',
            'workItemType must be Epic, Feature, User Story, Task, or Bug.',
            { hint: 'Sherlock does not invent process types. Delete is not available.' }
        );
    }
    const names = await getProjectContext().getWorkItemTypeNames().catch(() => [] as string[]);
    if (names.length === 0) return;
    if (!names.some(name => name.toLowerCase() === type.toLowerCase())) {
        throw new AppError(
            'INVALID_INPUT',
            `Work-item type "${type}" is not available in this Azure DevOps project.`,
            { hint: `Types discovered: ${names.join(', ')}.` }
        );
    }
}
