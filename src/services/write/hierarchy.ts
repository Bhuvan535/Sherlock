import { AppError } from '../../utils/errors.js';

const EXPECTED_PARENT: Record<string, string> = {
    Feature: 'Epic',
    'User Story': 'Feature',
    Task: 'User Story'
};

const BUG_PARENTS = new Set(['User Story', 'Feature']);

export function assertCanRemoveParent(childType: string): void {
    if (childType.trim() === 'Feature') {
        throw new AppError('INVALID_INPUT', 'A Feature must remain under an Epic. Set a new parent instead of removing it.');
    }
    if (childType.trim() === 'Epic') {
        throw new AppError('INVALID_INPUT', 'Epic is already a root item.');
    }
}

export function assertNoHierarchyCycle(childId: number, parentId: number, parentOf: (id: number) => number | null | undefined): void {
    let current: number | null | undefined = parentId;
    const seen = new Set<number>();
    while (current) {
        if (current === childId) {
            throw new AppError('INVALID_INPUT', `Parent #${parentId} would create a circular hierarchy with #${childId}.`);
        }
        if (seen.has(current)) break;
        seen.add(current);
        current = parentOf(current);
    }
}

export function assertHierarchy(childType: string, parentType: string | null | undefined): void {
    const child = childType.trim();
    if (child === 'Epic' && parentType) {
        throw new AppError('INVALID_INPUT', 'Epic must not have a parent.');
    }
    if (child === 'Feature' && !parentType) {
        throw new AppError('INVALID_INPUT', 'Feature requires an Epic parent.');
    }
    if (!parentType) return;
    if (child === 'Bug') {
        if (!BUG_PARENTS.has(parentType)) {
            throw new AppError('INVALID_INPUT', 'A Bug may only be parented to a User Story or Feature.');
        }
        return;
    }
    const needed = EXPECTED_PARENT[child];
    if (needed && parentType !== needed) {
        throw new AppError(
            'INVALID_INPUT',
            `${child} must be parented to ${needed}, not ${parentType}. Hierarchy is Epic→Feature→User Story→Task.`
        );
    }
}
