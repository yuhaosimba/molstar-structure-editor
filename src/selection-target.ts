import { StructureHierarchy, StructureHierarchyRef, StructureRef } from 'molstar/lib/mol-plugin-state/manager/structure/hierarchy-state';

type ResolvedStructureTarget = {
    structureRef: StructureRef
    modelRef: string
};

function asStructureRef(ref: StructureHierarchyRef | undefined): StructureRef | undefined {
    if (!ref) return void 0;
    if (ref.kind === 'structure') return ref;
    if ('structure' in ref && ref.structure) return ref.structure;
    if ('parent' in ref && ref.parent) return asStructureRef(ref.parent);
    return void 0;
}

export function resolveStructureTargetFromHierarchy(hierarchy: StructureHierarchy, parentRef: string): ResolvedStructureTarget | undefined {
    const structureRef = asStructureRef(hierarchy.refs.get(parentRef));
    const modelRef = structureRef?.model?.cell.transform.ref;
    if (!structureRef || !modelRef) return void 0;
    return { structureRef, modelRef };
}

export function getSingleSelectionEntry(entries: Map<string, any>) {
    const selected = Array.from(entries.entries())
        .filter(([, entry]) => !!(entry.structure ?? entry._structure ?? entry.selection?.structure ?? entry._selection?.structure));
    if (selected.length === 0) return;
    if (selected.length > 1) {
        throw new Error('Editing selections spanning multiple structures is not supported in v1.');
    }

    const [ref, entry] = selected[0];
    return { ref, entry };
}
