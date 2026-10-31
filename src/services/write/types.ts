export const ALLOWED_CREATE_TYPES = ['Epic', 'Feature', 'User Story', 'Task', 'Bug'] as const;
export type AllowedCreateType = (typeof ALLOWED_CREATE_TYPES)[number];

export const WRITE_OPERATIONS = [
    'CREATE_WORK_ITEM',
    'UPDATE_WORK_ITEM',
    'SET_PARENT',
    'REMOVE_PARENT',
    'ADD_PREDECESSOR',
    'REMOVE_PREDECESSOR',
    'ADD_COMMENT'
] as const;
export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export interface CreateWorkItemInput {
    workItemType: string;
    title: string;
    description?: string;
    assignedTo?: string;
    state?: string;
    priority?: number;
    iterationPath?: string;
    areaPath?: string;
    tags?: string[];
    plannedStart?: string;
    plannedEnd?: string;
    actualStart?: string;
    actualEnd?: string;
    parentId?: number;
    acceptanceCriteria?: string;
    reproductionSteps?: string;
}

export interface UpdateWorkItemChanges {
    title?: string;
    description?: string;
    state?: string;
    priority?: number;
    assignedTo?: string;
    iterationPath?: string;
    areaPath?: string;
    plannedStart?: string;
    plannedEnd?: string;
    actualStart?: string;
    actualEnd?: string;
    acceptanceCriteria?: string;
    addTags?: string[];
    removeTags?: string[];
    replaceTags?: string[];
}

export interface RelationshipChangeInput {
    action: 'set_parent' | 'remove_parent' | 'add_predecessor' | 'remove_predecessor';
    workItemId: number;
    targetId?: number;
}

export interface FieldSnapshot {
    id?: number;
    rev?: number;
    type?: string;
    title?: string | null;
    description?: string | null;
    state?: string | null;
    assignedTo?: string | null;
    priority?: number | null;
    iterationPath?: string | null;
    areaPath?: string | null;
    tags?: string[];
    plannedStart?: string | null;
    plannedEnd?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
    url?: string | null;
}

export interface PlannedChange {
    field: string;
    adoField: string;
    current: string | number | null;
    proposed: string | number | null;
}

export interface PlannedWrite {
    operation: WriteOperation;
    workItemType: string;
    workItemId: number | null;
    revision: number | null;
    parentId?: number | null;
    parentTitle?: string;
    parentUrl?: string;
    relatedWorkItemId?: number;
    relatedUrl?: string;
    commentText?: string;
    removeRelationIndex?: number;
    snapshot: FieldSnapshot;
    changes: PlannedChange[];
    resolvedFields: Record<string, string | number>;
    addTags: string[];
    removeTags: string[];
    warnings?: { ruleId: string; message: string }[];
}

export interface JsonPatchOp {
    op: 'add' | 'replace' | 'remove' | 'test';
    path: string;
    value?: unknown;
}

export interface PendingWrite {
    confirmationId: string;
    requestId: string;
    userId: string;
    expiresAt: number;
    planned: PlannedWrite;
    executed: boolean;
    result?: Record<string, unknown>;
}
