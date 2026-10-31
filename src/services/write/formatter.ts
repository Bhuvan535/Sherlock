import { getConfig } from '../../config/env.js';
import { getNavigationEngine } from '../../core/navigation-engine.js';
import type { FieldSnapshot, PlannedWrite } from './types.js';

export function formatPreparePreview(planned: PlannedWrite, confirmationId: string): string {
    const config = getConfig();
    const lines: string[] = [];
    if (planned.operation === 'CREATE_WORK_ITEM') {
        lines.push('Proposed Work Item', '');
        lines.push(`Type: ${planned.workItemType}`);
        lines.push(`Title: ${planned.resolvedFields.title}`);
        lines.push(`Project: ${config.ado.project}`);
        lines.push(`Team: ${config.ado.team}`);
        if (planned.parentId) {
            lines.push(`Parent: #${planned.parentId}${planned.parentTitle ? ` ${planned.parentTitle}` : ''}`);
        }
    } else if (planned.operation === 'SET_PARENT') {
        lines.push('Proposed Parent Change', '');
        lines.push(`Work Item: #${planned.workItemId}`);
        lines.push(`New parent: #${planned.parentId}${planned.parentTitle ? ` ${planned.parentTitle}` : ''}`);
    } else if (planned.operation === 'REMOVE_PARENT') {
        lines.push('Proposed Parent Removal', '');
        lines.push(`Work Item: #${planned.workItemId}`);
    } else if (planned.operation === 'ADD_PREDECESSOR') {
        lines.push('Proposed Dependency', '');
        lines.push(`Work Item: #${planned.workItemId} waits on predecessor #${planned.relatedWorkItemId}`);
    } else if (planned.operation === 'REMOVE_PREDECESSOR') {
        lines.push('Proposed Dependency Removal', '');
        lines.push(`Work Item: #${planned.workItemId} will no longer wait on #${planned.relatedWorkItemId}`);
    } else if (planned.operation === 'ADD_COMMENT') {
        lines.push('Proposed Comment', '');
        lines.push(`Work Item: #${planned.workItemId}`);
        lines.push(`Text: ${planned.commentText}`);
    } else {
        lines.push('Proposed Change', '');
        lines.push(`Work Item: #${planned.workItemId}`);
        lines.push(`Title: ${planned.snapshot.title ?? ''}`);
        lines.push(`Type: ${planned.workItemType}`);
    }

    lines.push('', '| Field | Current | Proposed |', '| --- | --- | --- |');
    for (const change of planned.changes) {
        lines.push(`| ${change.field} | ${change.current ?? '—'} | ${change.proposed ?? '—'} |`);
    }
    if (planned.addTags.length) lines.push(`| addTags | — | ${planned.addTags.join(', ')} |`);
    if (planned.removeTags.length) lines.push(`| removeTags | ${planned.snapshot.tags?.join(', ') ?? '—'} | ${planned.removeTags.join(', ')} |`);

    if (planned.warnings?.length) {
        lines.push('', 'Validation notes (will not block after confirmation):');
        for (const warning of planned.warnings) lines.push(`- ${warning.message}`);
    }

    if (planned.revision != null) lines.push('', `Revision: ${planned.revision}`);
    lines.push('', 'No Azure DevOps changes have been made yet.', '', `Confirmation ID: ${confirmationId}`);
    lines.push('Show these proposed changes to the user. Once they explicitly approve, call sherlock_confirm_write with this confirmation ID.');
    return lines.join('\n');
}

export function formatExecuteResult(
    planned: PlannedWrite,
    after: FieldSnapshot,
    previousRev: number | null
): string {
    const lines: string[] = [];
    const id = after.id ?? planned.workItemId;
    if (planned.operation === 'CREATE_WORK_ITEM') {
        lines.push(`Work Item #${id} created successfully.`, '');
        lines.push(`Type: ${after.type ?? planned.workItemType}`);
        lines.push(`Title: ${after.title ?? ''}`);
        lines.push(`State: ${after.state ?? ''}`);
        lines.push(`Assigned To: ${after.assignedTo ?? 'Unassigned'}`);
    } else if (planned.operation === 'SET_PARENT') {
        lines.push(`Work Item #${id} parent updated successfully.`, '');
        lines.push(`Parent: #${planned.parentId}${planned.parentTitle ? ` ${planned.parentTitle}` : ''}`);
    } else if (planned.operation === 'REMOVE_PARENT') {
        lines.push(`Work Item #${id} parent removed successfully.`);
    } else if (planned.operation === 'ADD_PREDECESSOR') {
        lines.push(`Work Item #${id} now waits on predecessor #${planned.relatedWorkItemId}.`);
    } else if (planned.operation === 'REMOVE_PREDECESSOR') {
        lines.push(`Predecessor #${planned.relatedWorkItemId} removed from work item #${id}.`);
    } else if (planned.operation === 'ADD_COMMENT') {
        lines.push(`Comment added to work item #${id}.`);
    } else {
        lines.push(`Work Item #${id} updated successfully.`, '');
        lines.push('Changes applied:');
        for (const change of planned.changes) {
            lines.push(`- ${change.field}: ${change.current ?? '—'} → ${change.proposed ?? '—'}`);
        }
        if (planned.addTags.length) lines.push(`- tags added: ${planned.addTags.join(', ')}`);
        if (planned.removeTags.length) lines.push(`- tags removed: ${planned.removeTags.join(', ')}`);
        if (previousRev != null && after.rev != null) {
            lines.push('', `Revision: ${previousRev} → ${after.rev}`);
        }
    }
    const url = after.url ?? (id ? getNavigationEngine().getWorkItemUrl(getConfig().ado.project, id) : null);
    if (url) lines.push('', `[Open Work Item](${url})`);
    return lines.join('\n');
}
