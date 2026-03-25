import { describe, expect, it } from 'vitest';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { parsePDB } from 'molstar/lib/mol-io/reader/pdb/parser';
import { trajectoryFromPDB } from 'molstar/lib/mol-model-formats/structure/pdb';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure';
import {
    applyRotationStep,
    applyTranslationStep,
    cancelSession,
    commitSession,
    createEditSession,
} from '../session';

const PDB = `\
HETATM    1  C1  UNL A   1       0.000   0.000   0.000  1.00  0.00           C  
HETATM    2  C2  UNL A   1       1.500   0.000   0.000  1.00  0.00           C  
HETATM    3  O1  UNL A   1       0.000   1.200   0.000  1.00  0.00           O  
END\
`;

async function createSelection(count = 2) {
    const parsed = await parsePDB(PDB, 'structure-editor-test').run();
    if (parsed.isError) throw new Error(parsed.message);
    const traj = await trajectoryFromPDB(parsed.result).run();
    const model = traj.representative;
    const structure = Structure.ofModel(model);
    const unit = structure.units[0];
    const selection = StructureElement.Loci(structure, [{
        unit,
        indices: OrderedSet.ofRange(0 as StructureElement.UnitIndex, (count - 1) as StructureElement.UnitIndex)
    }]);
    return { model, structure, selection };
}

describe('edit session', () => {
    it('captures selected atom ids and centroid from the selection loci', async () => {
        const { model, structure, selection } = await createSelection(2);
        const session = createEditSession({ model, structure, selection, maxRealtimeAtoms: 128 });

        expect(session.atomIndices).toEqual([0, 1]);
        expect(session.centroid[0]).toBeCloseTo(0.75);
        expect(session.centroid[1]).toBeCloseTo(0);
        expect(session.centroid[2]).toBeCloseTo(0);
    });

    it('applies translation only to the selected atoms', async () => {
        const { model, structure, selection } = await createSelection(2);
        const session = createEditSession({ model, structure, selection, maxRealtimeAtoms: 128 });

        applyTranslationStep(session, Vec3.create(1, 0, 0), 2);

        expect(session.currentFrame.x[0]).toBeCloseTo(2);
        expect(session.currentFrame.x[1]).toBeCloseTo(3.5);
        expect(session.currentFrame.x[2]).toBeCloseTo(0);
        expect(session.currentFrame.y[2]).toBeCloseTo(1.2);
    });

    it('rotates the selected atoms around the session centroid', async () => {
        const { model, structure, selection } = await createSelection(2);
        const session = createEditSession({ model, structure, selection, maxRealtimeAtoms: 128 });

        applyRotationStep(session, Vec3.create(0, 0, 1), Math.PI);

        expect(session.currentFrame.x[0]).toBeCloseTo(1.5, 5);
        expect(session.currentFrame.x[1]).toBeCloseTo(0, 5);
        expect(session.currentFrame.y[0]).toBeCloseTo(0, 5);
        expect(session.currentFrame.y[1]).toBeCloseTo(0, 5);
    });

    it('cancel restores the original coordinates and commit updates the baseline', async () => {
        const { model, structure, selection } = await createSelection(2);
        const session = createEditSession({ model, structure, selection, maxRealtimeAtoms: 128 });

        applyTranslationStep(session, Vec3.create(0, 1, 0), 1.5);
        commitSession(session);
        expect(session.baseFrame.y[0]).toBeCloseTo(1.5);

        applyTranslationStep(session, Vec3.create(0, 1, 0), 2);
        cancelSession(session);

        expect(session.currentFrame.y[0]).toBeCloseTo(1.5);
        expect(session.currentFrame.y[1]).toBeCloseTo(1.5);
        expect(session.currentFrame.y[2]).toBeCloseTo(1.2);
    });
});
