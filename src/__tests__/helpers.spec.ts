import { describe, expect, it } from 'vitest';
import { getSingleSelectionEntry, resolveStructureTargetFromHierarchy } from '../selection-target';

describe('getSingleSelectionEntry', () => {
    it('returns the stable selection ref together with the entry', () => {
        const first = { structure: { id: 1 }, selection: 'a' } as any;
        const second = { selection: 'b' } as any;
        const entries = new Map<string, any>([
            ['first-ref', first],
            ['second-ref', second],
        ]);

        expect(getSingleSelectionEntry(entries)).toEqual({
            ref: 'first-ref',
            entry: first,
        });
    });

    it('throws when selections span multiple structures', () => {
        const entries = new Map<string, any>([
            ['first-ref', { structure: { id: 1 } }],
            ['second-ref', { structure: { id: 2 } }],
        ]);

        expect(() => getSingleSelectionEntry(entries)).toThrowError('Editing selections spanning multiple structures is not supported in v1.');
    });
});

describe('resolveStructureTargetFromHierarchy', () => {
    it('resolves direct structure refs to the owning model ref', () => {
        const model = {
            kind: 'model',
            cell: { transform: { ref: 'model-ref' } },
        } as any;
        const structure = {
            kind: 'structure',
            cell: { transform: { ref: 'structure-ref' } },
            model,
        } as any;

        const hierarchy = {
            refs: new Map([
                ['structure-ref', structure],
                ['model-ref', model],
            ]),
        } as any;

        expect(resolveStructureTargetFromHierarchy(hierarchy, 'structure-ref')).toEqual({
            structureRef: structure,
            modelRef: 'model-ref',
        });
    });

    it('resolves structure-transform refs back to the underlying structure', () => {
        const model = {
            kind: 'model',
            cell: { transform: { ref: 'model-ref' } },
        } as any;
        const structure = {
            kind: 'structure',
            cell: { transform: { ref: 'structure-ref' } },
            model,
        } as any;
        const transform = {
            kind: 'structure-transform',
            cell: { transform: { ref: 'transform-ref' } },
            structure,
        } as any;

        const hierarchy = {
            refs: new Map([
                ['model-ref', model],
                ['structure-ref', structure],
                ['transform-ref', transform],
            ]),
        } as any;

        expect(resolveStructureTargetFromHierarchy(hierarchy, 'transform-ref')).toEqual({
            structureRef: structure,
            modelRef: 'model-ref',
        });
    });
});
