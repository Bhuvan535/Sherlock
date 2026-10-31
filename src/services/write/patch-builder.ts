import { RELATION } from '../../azure-devops/fields.js';
import type { JsonPatchOp, PlannedWrite } from './types.js';

const RELATION_OPS = new Set(['SET_PARENT', 'REMOVE_PARENT', 'ADD_PREDECESSOR', 'REMOVE_PREDECESSOR']);

export class WritePatchBuilder {
    build(planned: PlannedWrite): JsonPatchOp[] {
        if (planned.operation === 'ADD_COMMENT') return [];

        const ops: JsonPatchOp[] = [];
        if (planned.operation !== 'CREATE_WORK_ITEM') {
            if (planned.revision == null) {
                throw new Error('Update patch requires a revision.');
            }
            ops.push({ op: 'test', path: '/rev', value: planned.revision });
        }

        if (RELATION_OPS.has(planned.operation)) {
            if (planned.removeRelationIndex != null) {
                ops.push({ op: 'remove', path: `/relations/${planned.removeRelationIndex}` });
            }
            if (planned.operation === 'SET_PARENT' && planned.parentUrl) {
                ops.push({
                    op: 'add',
                    path: '/relations/-',
                    value: {
                        rel: RELATION.parent,
                        url: planned.parentUrl,
                        attributes: { name: 'Parent' }
                    }
                });
            }
            if (planned.operation === 'ADD_PREDECESSOR' && planned.relatedUrl) {
                ops.push({
                    op: 'add',
                    path: '/relations/-',
                    value: {
                        rel: RELATION.predecessor,
                        url: planned.relatedUrl,
                        attributes: { name: 'Predecessor' }
                    }
                });
            }
            return ops;
        }

        const seen = new Set<string>();
        for (const change of planned.changes) {
            if (seen.has(change.adoField)) continue;
            seen.add(change.adoField);
            const value = planned.resolvedFields[change.field];
            if (value === undefined) continue;
            ops.push({
                op: planned.operation === 'CREATE_WORK_ITEM' || change.current == null ? 'add' : 'replace',
                path: `/fields/${change.adoField}`,
                value
            });
        }

        const nextTags = this.nextTagString(planned);
        if (nextTags !== null) {
            ops.push({
                op: planned.snapshot.tags && planned.snapshot.tags.length > 0 ? 'replace' : 'add',
                path: '/fields/System.Tags',
                value: nextTags
            });
        }

        if (planned.parentId && planned.operation === 'CREATE_WORK_ITEM' && planned.parentUrl) {
            ops.push({
                op: 'add',
                path: '/relations/-',
                value: {
                    rel: RELATION.parent,
                    url: planned.parentUrl,
                    attributes: { name: 'Parent' }
                }
            });
        }

        return ops;
    }

    private nextTagString(planned: PlannedWrite): string | null {
        if (planned.addTags.length === 0 && planned.removeTags.length === 0) return null;
        const current = new Set((planned.snapshot.tags ?? []).map(t => t.trim()).filter(Boolean));
        for (const tag of planned.removeTags) {
            for (const existing of [...current]) {
                if (existing.toLowerCase() === tag.toLowerCase()) current.delete(existing);
            }
        }
        for (const tag of planned.addTags) current.add(tag);
        return [...current].join('; ');
    }
}
