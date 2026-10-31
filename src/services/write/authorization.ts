/**
 * ============================================================================
 * Write authorization: the code-level gate in front of every Azure DevOps
 * mutation.
 * ============================================================================
 *
 * The rule this module enforces is:
 *
 *   A write executes because an APPROVED OPERATION exists, never because a
 *   tool was called.
 *
 * Three independent facts must hold before Azure DevOps is mutated:
 *
 *  1. Presentation - the proposal was actually rendered and returned to the
 *     client (`markPresented` runs in the tool registry, after the preview has
 *     been serialised into the MCP response). Code paths that mutate without
 *     first producing a preview can never satisfy this.
 *
 *  2. Approval - an explicit confirmation call claimed that exact
 *     confirmation id, moving the operation to APPROVED.
 *
 *  3. Scope - the mutation runs inside `runAuthorizedWrite`, so
 *     `assertWriteAuthorized` at the Azure DevOps client boundary can see the
 *     approved operation. Any other caller reaching the write client throws
 *     WRITE_NOT_AUTHORIZED, which makes a bypass a hard failure rather than a
 *     silent write.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import type { PlannedWorkItem, WorkItemPlan } from '../../planning/types.js';

export type ApprovalScope = 'work_item' | 'deployment';

export interface WriteAuthorization {
    confirmationId: string;
    scope: ApprovalScope;
    subjectId: string;
    planId?: string | null;
    planVersion?: number | null;
    planHash?: string | null;
    approvedAt: string;
}

const authorizationScope = new AsyncLocalStorage<WriteAuthorization>();

/** Runs `fn` with an approved operation in scope. The only way to enable a write. */
export function runAuthorizedWrite<T>(authorization: WriteAuthorization, fn: () => Promise<T>): Promise<T> {
    return authorizationScope.run(authorization, fn);
}

export function currentWriteAuthorization(): WriteAuthorization | undefined {
    return authorizationScope.getStore();
}

/**
 * Final guard, called immediately before an Azure DevOps mutation leaves the
 * process. Defense in depth: even if a future tool calls the write client
 * directly, the write is refused.
 */
export function assertWriteAuthorized(operation: string): WriteAuthorization {
    const authorization = authorizationScope.getStore();
    if (!authorization) {
        throw new AppError(
            'WRITE_NOT_AUTHORIZED',
            `Refused ${operation}: no user-approved operation is in scope.`,
            {
                hint: 'Azure DevOps changes require a prepared proposal that was shown to the user and then explicitly confirmed. Prepare the change, show it, and confirm it.'
            }
        );
    }
    return authorization;
}

// --------------------------------------------------------------- presentation

/** Confirmation ids whose proposal has actually been returned to the client. */
const presentedAt = new Map<string, string>();

export function markPresented(confirmationId: string): void {
    const id = confirmationId.trim();
    if (!id) return;
    if (!presentedAt.has(id)) presentedAt.set(id, new Date().toISOString());
}

export function presentedTimestamp(confirmationId: string): string | undefined {
    return presentedAt.get(confirmationId.trim());
}

export function assertPresented(confirmationId: string): string {
    const at = presentedAt.get(confirmationId.trim());
    if (!at) {
        throw new AppError(
            'WRITE_NOT_AUTHORIZED',
            'These changes were never presented for review, so they cannot be confirmed.',
            { hint: 'Call the matching prepare tool first and show the proposal to the user.' }
        );
    }
    return at;
}

export function forgetPresentation(confirmationId: string): void {
    presentedAt.delete(confirmationId.trim());
}

export function resetPresentationRegistry(): void {
    presentedAt.clear();
}

// ----------------------------------------------------------------- plan hash

/**
 * Content hash of a plan. Deliberately ignores `status` and `version` so that
 * lifecycle bookkeeping does not invalidate an approval, while any change to
 * the actual proposed work does.
 */
export function computePlanHash(plan: WorkItemPlan): string {
    const items = [...(plan.workItems ?? [])]
        .map(canonicalItem)
        .sort((a, b) => a.temporaryId.localeCompare(b.temporaryId));
    const dependencies = [...(plan.dependencies ?? [])]
        .map(dependency => ({
            from: dependency.fromTemporaryId,
            to: dependency.toTemporaryId,
            kind: dependency.kind ?? null
        }))
        .sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
    return createHash('sha256').update(JSON.stringify({ items, dependencies })).digest('hex').slice(0, 16);
}

function canonicalItem(item: PlannedWorkItem) {
    return {
        temporaryId: item.temporaryId,
        type: item.type,
        parentTemporaryId: item.parentTemporaryId ?? null,
        title: item.title ?? null,
        description: item.description ?? null,
        assignedTo: item.assignedTo ?? null,
        area: item.area ?? null,
        iteration: item.iteration ?? null,
        state: item.state ?? null,
        priority: item.priority ?? null,
        plannedStart: item.plannedStart ?? null,
        plannedEnd: item.plannedEnd ?? null,
        acceptanceCriteria: Array.isArray(item.acceptanceCriteria)
            ? item.acceptanceCriteria.join('|')
            : item.acceptanceCriteria ?? null,
        reproductionSteps: item.reproductionSteps ?? null,
        existingAdoId: item.existingAdoId ?? null
    };
}
