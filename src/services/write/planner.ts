import { AppError } from '../../utils/errors.js';
import { getConfig } from '../../config/env.js';
import { getAdoClient } from '../../azure-devops/client.js';
import { getWorkItemService } from '../../azure-devops/work-item.service.js';
import { getTeamService } from '../../azure-devops/team.service.js';
import { getSprintService } from '../../azure-devops/sprint.service.js';
import { FieldMappingService } from '../../azure-devops/field-mapping.js';
import { FIELD, RELATION } from '../../azure-devops/fields.js';
import type { WorkItem } from '../../azure-devops/types.js';
import { resolveWriteField } from './field-map.js';
import { assertFieldForType, assertTypeAvailable } from './capabilities.js';
import { assertCanRemoveParent, assertHierarchy, assertNoHierarchyCycle } from './hierarchy.js';
import { applyPlanningGate } from './planning-gate.js';
import { WriteRequestValidator } from './validator.js';
import type {
    CreateWorkItemInput,
    FieldSnapshot,
    PlannedChange,
    PlannedWrite,
    RelationshipChangeInput,
    UpdateWorkItemChanges
} from './types.js';

function display(value: string | number | null | undefined): string | number | null {
    if (value === undefined || value === null || value === '') return null;
    return value;
}

function workItemApiUrl(id: number): string {
    const config = getConfig().ado;
    return `${config.baseUrl}/${encodeURIComponent(config.project)}/_apis/wit/workItems/${id}`;
}

export class WriteChangePlanner {
    constructor(private readonly validator = new WriteRequestValidator()) {}

    async planCreate(input: CreateWorkItemInput): Promise<PlannedWrite> {
        this.validator.validateCreate(input);
        await assertTypeAvailable(input.workItemType);
        const dates = await new FieldMappingService(getConfig().ado.project).getCanonicalMap();
        const resolved: Record<string, string | number> = { title: input.title.trim() };
        const changes: PlannedChange[] = [
            {
                field: 'title',
                adoField: FIELD.title,
                current: null,
                proposed: input.title.trim()
            }
        ];

        const optional: Array<[string, string | number | undefined]> = [
            ['description', input.description],
            ['state', input.state],
            ['priority', input.priority],
            ['assignedTo', input.assignedTo],
            ['iterationPath', input.iterationPath],
            ['areaPath', input.areaPath],
            ['plannedStart', input.plannedStart],
            ['plannedEnd', input.plannedEnd],
            ['actualStart', input.actualStart],
            ['actualEnd', input.actualEnd],
            ['acceptanceCriteria', input.acceptanceCriteria],
            ['reproductionSteps', input.reproductionSteps]
        ];

        for (const [field, raw] of optional) {
            if (raw === undefined || raw === '') continue;
            assertFieldForType(input.workItemType, field);
            const adoField = resolveWriteField(field, dates, input.workItemType);
            if (!adoField) {
                throw new AppError('INVALID_INPUT', `Field "${field}" is not available in this Azure DevOps process.`);
            }
            const value = typeof raw === 'string' ? raw.trim() : raw;
            resolved[field] = value;
            changes.push({ field, adoField, current: null, proposed: value });
        }

        if (input.assignedTo) {
            resolved.assignedTo = await this.resolveAssignee(input.assignedTo);
            const row = changes.find(c => c.field === 'assignedTo');
            if (row) row.proposed = resolved.assignedTo;
        }
        if (input.state) await this.assertState(input.workItemType, input.state);
        if (input.iterationPath) await this.assertIteration(input.iterationPath);
        if (input.areaPath) await this.assertArea(input.areaPath);

        let parentTitle: string | undefined;
        let parentUrl: string | undefined;
        if (input.parentId) {
            parentUrl = workItemApiUrl(input.parentId);
            const [parent] = await getWorkItemService().getByIds([input.parentId]);
            if (!parent) {
                throw new AppError('NOT_FOUND', `Parent work item #${input.parentId} was not found.`);
            }
            parentTitle = parent.title;
            parentUrl = parent.url ?? parent.webUrl ?? parentUrl;
            assertHierarchy(input.workItemType, parent.type);
        } else {
            assertHierarchy(input.workItemType, null);
        }

        const tags = this.validator.normalizeTags(input.tags);
        if (tags.length) resolved.tags = tags.join('; ');

        const planned: PlannedWrite = {
            operation: 'CREATE_WORK_ITEM',
            workItemType: input.workItemType.trim(),
            workItemId: null,
            revision: null,
            parentId: input.parentId,
            parentTitle,
            parentUrl,
            snapshot: { type: input.workItemType.trim(), title: input.title.trim(), tags: [] },
            changes,
            resolvedFields: resolved,
            addTags: tags,
            removeTags: []
        };
        planned.warnings = await this.maybePlanningGate(planned);
        return planned;
    }

    async planUpdate(workItemId: number, changes: UpdateWorkItemChanges): Promise<PlannedWrite> {
        this.validator.validateUpdate(workItemId, changes);
        const item = await getWorkItemService().getById(workItemId, { includeRelations: false });
        this.validator.assertUpdateFieldsForType(item.type, changes);
        const dates = await new FieldMappingService(getConfig().ado.project).getCanonicalMap();
        const snapshot = this.snapshot(item);
        const plannedChanges: PlannedChange[] = [];
        const resolved: Record<string, string | number> = {};

        const scalar: Array<[keyof UpdateWorkItemChanges, string | number | undefined | null]> = [
            ['title', changes.title],
            ['description', changes.description],
            ['state', changes.state],
            ['priority', changes.priority],
            ['assignedTo', changes.assignedTo],
            ['iterationPath', changes.iterationPath],
            ['areaPath', changes.areaPath],
            ['plannedStart', changes.plannedStart],
            ['plannedEnd', changes.plannedEnd],
            ['actualStart', changes.actualStart],
            ['actualEnd', changes.actualEnd],
            ['acceptanceCriteria', changes.acceptanceCriteria]
        ];

        for (const [field, raw] of scalar) {
            if (raw === undefined) continue;
            if (field === 'description' && raw === '') {
                const adoField = resolveWriteField('description', dates, item.type)!;
                plannedChanges.push({ field: 'description', adoField, current: snapshot.description ?? null, proposed: '' });
                resolved.description = '';
                continue;
            }
            if (raw === '') {
                throw new AppError('INVALID_INPUT', `${field} cannot be empty unless clearing description.`);
            }
            const adoField = resolveWriteField(field, dates, item.type);
            if (!adoField) {
                throw new AppError('INVALID_INPUT', `Field "${field}" is not available in this Azure DevOps process.`);
            }
            let value: string | number = typeof raw === 'string' ? raw.trim() : (raw as number);
            if (field === 'assignedTo') value = await this.resolveAssignee(String(value));
            if (field === 'state') await this.assertState(item.type, String(value));
            if (field === 'iterationPath') await this.assertIteration(String(value));
            if (field === 'areaPath') await this.assertArea(String(value));
            const current = this.currentOf(snapshot, field);
            if (String(current ?? '') === String(value)) continue;
            plannedChanges.push({ field, adoField, current, proposed: value });
            resolved[field] = value;
        }

        let addTags = this.validator.normalizeTags(changes.addTags);
        let removeTags = this.validator.normalizeTags(changes.removeTags);
        if (changes.replaceTags) {
            const next = this.validator.normalizeTags(changes.replaceTags);
            removeTags = snapshot.tags ?? [];
            addTags = next;
        }
        if (plannedChanges.length === 0 && addTags.length === 0 && removeTags.length === 0) {
            throw new AppError('INVALID_INPUT', 'No effective changes: requested values already match the work item.');
        }

        const planned: PlannedWrite = {
            operation: 'UPDATE_WORK_ITEM',
            workItemType: item.type,
            workItemId: item.id,
            revision: item.rev,
            snapshot,
            changes: plannedChanges,
            resolvedFields: resolved,
            addTags,
            removeTags
        };
        planned.warnings = await this.maybePlanningGate(planned, item);
        return planned;
    }

    async planRelationship(input: RelationshipChangeInput): Promise<PlannedWrite> {
        if (input.action === 'set_parent') {
            if (input.targetId == null) throw new AppError('INVALID_INPUT', 'targetId (parent) is required.');
            return this.planSetParent(input.workItemId, input.targetId);
        }
        if (input.action === 'remove_parent') return this.planRemoveParent(input.workItemId);
        if (input.action === 'add_predecessor') {
            if (input.targetId == null) throw new AppError('INVALID_INPUT', 'targetId (predecessor) is required.');
            return this.planAddPredecessor(input.workItemId, input.targetId);
        }
        if (input.action === 'remove_predecessor') {
            if (input.targetId == null) throw new AppError('INVALID_INPUT', 'targetId (predecessor) is required.');
            return this.planRemovePredecessor(input.workItemId, input.targetId);
        }
        throw new AppError('INVALID_INPUT', 'Unsupported relationship action.');
    }

    async planSetParent(workItemId: number, parentId: number): Promise<PlannedWrite> {
        if (!Number.isInteger(workItemId) || workItemId <= 0 || !Number.isInteger(parentId) || parentId <= 0) {
            throw new AppError('INVALID_INPUT', 'workItemId and parentId must be positive integers.');
        }
        if (workItemId === parentId) {
            throw new AppError('INVALID_INPUT', 'A work item cannot be its own parent.');
        }
        const [child, parent] = await Promise.all([
            getWorkItemService().getById(workItemId, { includeRelations: true }),
            getWorkItemService().getById(parentId, { includeRelations: true })
        ]);
        assertHierarchy(child.type, parent.type);
        const chain = new Map<number, number | null>([[parent.id, parent.parentId ?? null]]);
        let cursor = parent.parentId;
        while (cursor) {
            if (cursor === child.id) {
                throw new AppError('INVALID_INPUT', `Parent #${parentId} would create a circular hierarchy with #${workItemId}.`);
            }
            const [next] = await getWorkItemService().getByIds([cursor]);
            if (!next) break;
            chain.set(next.id, next.parentId);
            cursor = next.parentId;
        }
        assertNoHierarchyCycle(child.id, parent.id, id => chain.get(id) ?? null);
        const parentUrl = parent.url ?? workItemApiUrl(parent.id);
        const parentRelIndex = (child.relations ?? []).findIndex(rel => rel.rel === RELATION.parent);
        const currentParent = child.parentId;
        if (currentParent === parentId) {
            throw new AppError('INVALID_INPUT', `Work item #${workItemId} is already parented to #${parentId}.`);
        }
        return {
            operation: 'SET_PARENT',
            workItemType: child.type,
            workItemId: child.id,
            revision: child.rev,
            parentId: parent.id,
            parentTitle: parent.title,
            parentUrl,
            removeRelationIndex: parentRelIndex >= 0 ? parentRelIndex : undefined,
            snapshot: this.snapshot(child),
            changes: [
                {
                    field: 'parent',
                    adoField: 'System.Parent',
                    current: currentParent,
                    proposed: parent.id
                }
            ],
            resolvedFields: { parent: parent.id },
            addTags: [],
            removeTags: []
        };
    }

    async planRemoveParent(workItemId: number): Promise<PlannedWrite> {
        const child = await getWorkItemService().getById(workItemId, { includeRelations: true });
        assertCanRemoveParent(child.type);
        const parentRelIndex = (child.relations ?? []).findIndex(rel => rel.rel === RELATION.parent);
        if (parentRelIndex < 0) {
            throw new AppError('INVALID_INPUT', `Work item #${workItemId} has no parent relationship.`);
        }
        return {
            operation: 'REMOVE_PARENT',
            workItemType: child.type,
            workItemId: child.id,
            revision: child.rev,
            parentId: null,
            removeRelationIndex: parentRelIndex,
            snapshot: this.snapshot(child),
            changes: [
                {
                    field: 'parent',
                    adoField: 'System.Parent',
                    current: child.parentId,
                    proposed: null
                }
            ],
            resolvedFields: {},
            addTags: [],
            removeTags: []
        };
    }

    async planAddPredecessor(workItemId: number, predecessorId: number): Promise<PlannedWrite> {
        if (workItemId === predecessorId) {
            throw new AppError('INVALID_INPUT', 'A work item cannot depend on itself.');
        }
        const [item, predecessor] = await Promise.all([
            getWorkItemService().getById(workItemId, { includeRelations: true }),
            getWorkItemService().getById(predecessorId, { includeRelations: true })
        ]);
        const existing = (item.relations ?? []).some(
            rel => rel.rel === RELATION.predecessor && this.relatedId(rel.url) === predecessorId
        );
        if (existing) {
            throw new AppError('INVALID_INPUT', `Work item #${workItemId} already waits on #${predecessorId}.`);
        }
        this.assertNoDependencyCycle(item, predecessor);
        return {
            operation: 'ADD_PREDECESSOR',
            workItemType: item.type,
            workItemId: item.id,
            revision: item.rev,
            relatedWorkItemId: predecessor.id,
            relatedUrl: predecessor.url ?? workItemApiUrl(predecessor.id),
            snapshot: this.snapshot(item),
            changes: [
                {
                    field: 'predecessor',
                    adoField: RELATION.predecessor,
                    current: null,
                    proposed: predecessor.id
                }
            ],
            resolvedFields: { predecessor: predecessor.id },
            addTags: [],
            removeTags: []
        };
    }

    async planRemovePredecessor(workItemId: number, predecessorId: number): Promise<PlannedWrite> {
        const item = await getWorkItemService().getById(workItemId, { includeRelations: true });
        const index = (item.relations ?? []).findIndex(
            rel => rel.rel === RELATION.predecessor && this.relatedId(rel.url) === predecessorId
        );
        if (index < 0) {
            throw new AppError('INVALID_INPUT', `Work item #${workItemId} has no predecessor link to #${predecessorId}.`);
        }
        return {
            operation: 'REMOVE_PREDECESSOR',
            workItemType: item.type,
            workItemId: item.id,
            revision: item.rev,
            relatedWorkItemId: predecessorId,
            removeRelationIndex: index,
            snapshot: this.snapshot(item),
            changes: [
                {
                    field: 'predecessor',
                    adoField: RELATION.predecessor,
                    current: predecessorId,
                    proposed: null
                }
            ],
            resolvedFields: {},
            addTags: [],
            removeTags: []
        };
    }

    async planAddComment(workItemId: number, text: string): Promise<PlannedWrite> {
        const body = text?.trim() ?? '';
        if (!body) throw new AppError('INVALID_INPUT', 'Comment text is required.');
        const item = await getWorkItemService().getById(workItemId, { includeRelations: false });
        return {
            operation: 'ADD_COMMENT',
            workItemType: item.type,
            workItemId: item.id,
            revision: item.rev,
            commentText: body,
            snapshot: this.snapshot(item),
            changes: [{ field: 'comment', adoField: 'System.History', current: null, proposed: body }],
            resolvedFields: { comment: body },
            addTags: [],
            removeTags: []
        };
    }

    private assertNoDependencyCycle(item: WorkItem, predecessor: WorkItem): void {
        const waitingOn = (node: WorkItem) =>
            (node.relations ?? [])
                .filter(rel => rel.rel === RELATION.predecessor)
                .map(rel => this.relatedId(rel.url))
                .filter((id): id is number => id != null);
        const stack = [...waitingOn(predecessor)];
        const seen = new Set<number>();
        while (stack.length) {
            const id = stack.pop()!;
            if (id === item.id) {
                throw new AppError('INVALID_INPUT', `Adding predecessor #${predecessor.id} would create a circular dependency.`);
            }
            if (seen.has(id)) continue;
            seen.add(id);
        }
    }

    private relatedId(url: string | undefined): number | null {
        const match = String(url ?? '').match(/work[Ii]tems\/(\d+)/);
        return match ? Number(match[1]) : null;
    }

    private async maybePlanningGate(planned: PlannedWrite, existing?: WorkItem) {
        const touchesPlanning = planned.changes.some(c =>
            ['iterationPath', 'plannedStart', 'plannedEnd', 'areaPath', 'assignedTo'].includes(c.field)
        );
        if (!touchesPlanning) return [];
        const issues = await applyPlanningGate({
            temporaryId: existing ? `ado-${existing.id}` : 'new-1',
            type: planned.workItemType,
            title: String(planned.resolvedFields.title ?? planned.snapshot.title ?? 'Untitled'),
            description: String(planned.resolvedFields.description ?? planned.snapshot.description ?? 'Prepared write'),
            assignedTo: String(planned.resolvedFields.assignedTo ?? planned.snapshot.assignedTo ?? 'Unassigned'),
            area: String(planned.resolvedFields.areaPath ?? planned.snapshot.areaPath ?? ''),
            iteration: String(planned.resolvedFields.iterationPath ?? planned.snapshot.iterationPath ?? ''),
            state: String(planned.resolvedFields.state ?? planned.snapshot.state ?? 'New'),
            priority: Number(planned.resolvedFields.priority ?? planned.snapshot.priority ?? 2),
            plannedStart: String(planned.resolvedFields.plannedStart ?? planned.snapshot.plannedStart ?? ''),
            plannedEnd: String(planned.resolvedFields.plannedEnd ?? planned.snapshot.plannedEnd ?? ''),
            existingAdoId: existing?.id ?? null
        });
        return issues.map(issue => ({ ruleId: issue.ruleId, message: issue.message }));
    }

    private snapshot(item: WorkItem): FieldSnapshot {
        return {
            id: item.id,
            rev: item.rev,
            type: item.type,
            title: item.title,
            description: item.description,
            state: item.state,
            assignedTo: item.assignedTo,
            priority: item.priority,
            iterationPath: item.iterationPath,
            areaPath: item.areaPath,
            tags: item.tags ?? [],
            plannedStart: item.plannedStart,
            plannedEnd: item.plannedEnd,
            actualStart: item.actualStart,
            actualEnd: item.actualEnd,
            url: item.url ?? item.webUrl
        };
    }

    private currentOf(snapshot: FieldSnapshot, field: string): string | number | null {
        const map: Record<string, string | number | null | undefined> = {
            title: snapshot.title,
            description: snapshot.description,
            state: snapshot.state,
            priority: snapshot.priority,
            assignedTo: snapshot.assignedTo,
            iterationPath: snapshot.iterationPath,
            areaPath: snapshot.areaPath,
            plannedStart: snapshot.plannedStart,
            plannedEnd: snapshot.plannedEnd,
            actualStart: snapshot.actualStart,
            actualEnd: snapshot.actualEnd,
            acceptanceCriteria: null
        };
        return display(map[field] ?? null);
    }

    private async resolveAssignee(name: string): Promise<string> {
        const members = await getTeamService().getMembers().catch(() => []);
        const needle = name.trim().toLowerCase();
        const match = members.find(
            m =>
                m.displayName.toLowerCase() === needle ||
                (m.email ?? '').toLowerCase() === needle ||
                m.displayName.toLowerCase().includes(needle)
        );
        if (!match) {
            throw new AppError('INVALID_INPUT', `Assigned To "${name}" does not match a team member.`, {
                hint: 'Use a team member display name or email from ado_get_team_members.'
            });
        }
        return match.email || match.displayName;
    }

    private async assertState(type: string, state: string): Promise<void> {
        const states = await getAdoClient()
            .getWorkItemTypeStates(getConfig().ado.project, type)
            .catch(() => []);
        this.validator.assertStateAllowed(
            state,
            states.map(s => s.name)
        );
    }

    private async assertIteration(path: string): Promise<void> {
        const iterations = await getSprintService().getIterations().catch(() => []);
        if (iterations.length === 0) return;
        const ok = iterations.some(it => it.path === path || it.name === path);
        if (!ok) {
            throw new AppError('INVALID_INPUT', `Iteration path "${path}" is not a known team sprint.`, {
                hint: 'Use ado_get_team_iterations for valid paths.'
            });
        }
    }

    private async assertArea(path: string): Promise<void> {
        const values = await getAdoClient()
            .getTeamFieldValues(getConfig().ado.project, getConfig().ado.team)
            .catch(() => null);
        const allowed = values?.values?.map(v => v.value) ?? [];
        if (allowed.length === 0) return;
        const ok = allowed.some(area => path === area || path.startsWith(`${area}\\`) || values?.defaultValue === path);
        if (!ok) {
            throw new AppError('INVALID_INPUT', `Area path "${path}" is outside the team area.`, {
                hint: `Expected a path under ${allowed.join(', ')}.`
            });
        }
    }
}
