export type PlanWorkItemType = 'Epic' | 'Feature' | 'User Story' | 'Task' | 'Bug';
export type RuleSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface PlannedWorkItem {
    temporaryId: string;
    type: PlanWorkItemType | string;
    parentTemporaryId?: string | null;
    title?: string | null;
    description?: string | null;
    assignedTo?: string | null;
    area?: string | null;
    iteration?: string | null;
    state?: string | null;
    priority?: number | null;
    plannedStart?: string | null;
    plannedEnd?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
    acceptanceCriteria?: string[] | string | null;
    reproductionSteps?: string | null;
    existingAdoId?: number | null;
}

export interface PlannedDependency {
    fromTemporaryId: string;
    toTemporaryId: string;
    kind?: string;
}

export type PlanStatus =
    | 'DRAFT'
    | 'VALID'
    | 'INVALID'
    | 'ACCEPTED'
    | 'AWAITING_CONFIRMATION'
    | 'APPROVED'
    | 'DEPLOYING'
    | 'COMPLETED'
    | 'PARTIALLY_COMPLETED'
    | 'FAILED'
    | 'EXPIRED';

export interface ExistingMatch {
    id: number;
    title: string;
    type: string;
    score: number;
}

export interface WorkItemPlan {
    planId?: string;
    project?: string;
    team?: string;
    summary?: string;
    assumptions?: string[];
    version?: number;
    status?: PlanStatus;
    workItems: PlannedWorkItem[];
    dependencies?: PlannedDependency[];
    existingMatches?: ExistingMatch[];
}

export interface RuleDefinition {
    ruleId: string;
    name: string;
    severity: RuleSeverity;
    appliesTo: string[];
    description: string;
}

export interface ValidationIssue {
    ruleId: string;
    severity: RuleSeverity;
    workItemId?: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    info: ValidationIssue[];
}

export interface PlanningIteration {
    name: string;
    path: string;
    startDate: string | null;
    finishDate: string | null;
    timeFrame: 'past' | 'current' | 'future' | 'unknown';
}

export interface PlanningMember {
    displayName: string;
    email: string | null;
}

export interface ExistingWorkHint {
    id: number;
    title: string;
    type: string;
    area?: string | null;
}

export interface AssigneeCapacity {
    assignee: string;
    availableDays: number;
    assignedDays: number;
}

/** Prepared once; rules must not call Azure DevOps themselves. */
export interface PlanningContext {
    now: Date;
    members: PlanningMember[];
    areaPaths: string[];
    iterations: PlanningIteration[];
    statesByType: Record<string, string[]>;
    existingWork: ExistingWorkHint[];
    capacity?: AssigneeCapacity[] | null;
    capacityAvailable: boolean;
    defaultAreaPath?: string | null;
}
