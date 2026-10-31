import { FieldMappingService } from '../../azure-devops/field-mapping.js';
import { FIELD, RELATION } from '../../azure-devops/fields.js';
import { asText } from '../../planning/helpers.js';
import type { PlannedWorkItem } from '../../planning/types.js';
import { resolveWriteField } from '../write/field-map.js';
import type { JsonPatchOp } from '../write/types.js';

export async function buildCreatePatch(
    project: string,
    item: PlannedWorkItem,
    parentApiUrl?: string | null
): Promise<JsonPatchOp[]> {
    const dates = await new FieldMappingService(project).getCanonicalMap();
    const ops: JsonPatchOp[] = [];
    const add = (logical: string, value: string | number | undefined | null): void => {
        if (value === undefined || value === null || value === '') return;
        const adoField = resolveWriteField(logical, dates, String(item.type));
        if (!adoField) return;
        ops.push({ op: 'add', path: `/fields/${adoField}`, value });
    };

    add('title', item.title?.trim());
    add('description', item.description?.trim());
    add('state', item.state?.trim());
    add('assignedTo', item.assignedTo?.trim());
    add('priority', item.priority ?? undefined);
    add('iterationPath', item.iteration?.trim());
    add('areaPath', item.area?.trim());
    add('plannedStart', item.plannedStart?.trim());
    add('plannedEnd', item.plannedEnd?.trim());
    const ac = asText(item.acceptanceCriteria);
    if (ac) add('acceptanceCriteria', ac);

    if (parentApiUrl) {
        ops.push({
            op: 'add',
            path: '/relations/-',
            value: {
                rel: RELATION.parent,
                url: parentApiUrl,
                attributes: { name: 'Parent' }
            }
        });
    }

    if (!ops.some(op => op.path === `/fields/${FIELD.title}`)) {
        throw new Error('Title is required to create a work item.');
    }
    return ops;
}

export function workItemApiUrl(baseUrl: string, project: string, id: number): string {
    return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}`;
}
