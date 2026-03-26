import { describe, expect, it } from 'vitest';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra';
import { Model, Structure } from 'molstar/lib/mol-model/structure';
import { createConstraintEditSession, commitConstraintSession, cancelConstraintSession } from '../constraint-session';

function createModel(points: Array<[number, number, number]>) {
    return {
        atomicConformation: {
            x: Float32Array.from(points.map(p => p[0])),
            y: Float32Array.from(points.map(p => p[1])),
            z: Float32Array.from(points.map(p => p[2])),
        },
    } as unknown as Model;
}

function createIntraUnitBonds(atomCount: number, edges: Array<[number, number]>) {
    const adjacency = Array.from({ length: atomCount }, () => [] as number[]);
    for (const [a, b] of edges) {
        adjacency[a].push(b);
        adjacency[b].push(a);
    }

    const offset = new Int32Array(atomCount + 1);
    let total = 0;
    for (let i = 0; i < atomCount; i++) {
        offset[i] = total;
        total += adjacency[i].length;
    }
    offset[atomCount] = total;

    const b = new Int32Array(total);
    let cursor = 0;
    for (let i = 0; i < atomCount; i++) {
        for (const neighbor of adjacency[i]) b[cursor++] = neighbor;
    }
    return { offset, b };
}

function createStructure(model: Model, atomCount: number, edges: Array<[number, number]>) {
    const unit = {
        id: 1,
        kind: 0,
        elements: Int32Array.from(Array.from({ length: atomCount }, (_, i) => i)),
        bonds: createIntraUnitBonds(atomCount, edges),
        conformation: { operator: { matrix: Mat4.identity() } },
    };
    return {
        model,
        units: [unit],
        interUnitBonds: { edges: [] },
    } as unknown as Structure;
}

describe('constraint edit sessions', () => {
    it('creates a distance session and updates the current value by moving the full fragment', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2]]),
            atomIndices: [0, 1],
        });

        expect(session.originalValue).toBeCloseTo(1, 5);

        session.update(2);

        expect(session.currentValue).toBeCloseTo(2, 5);
        expect(session.currentFrame.x[1]).toBeCloseTo(2, 5);
        expect(session.currentFrame.x[2]).toBeCloseTo(3, 5);
        expect(session.movableAtomIndices).toEqual([1, 2]);
    });

    it('cancels back to the base frame and commits the edited frame', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 2, [[0, 1]]),
            atomIndices: [0, 1],
        });

        session.update(2);
        cancelConstraintSession(session);
        expect(session.currentValue).toBeCloseTo(1, 5);

        session.update(3);
        commitConstraintSession(session);
        expect(session.baseFrame.x[1]).toBeCloseTo(3, 5);
        expect(session.originalValue).toBeCloseTo(3, 5);
    });

    it('can switch the locked atom for a distance constraint', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2]]),
            atomIndices: [0, 1],
        });

        session.setLockedAtomIndex(1);
        session.update(2);

        expect(session.anchorAtomIndices).toEqual([1]);
        expect(session.movableAtomIndices).toEqual([0]);
        expect(session.currentFrame.x[1]).toBeCloseTo(1, 5);
        expect(session.currentFrame.x[0]).toBeCloseTo(-1, 5);
        expect(session.currentFrame.x[2]).toBeCloseTo(2, 5);
    });

    it('moves the full C-side fragment for an angle constraint when A is locked', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 1, 0], [3, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'angle',
            model,
            structure: createStructure(model, 4, [[0, 1], [1, 2], [2, 3]]),
            atomIndices: [0, 1, 2],
        });

        session.update(120);

        expect(session.anchorAtomIndices).toEqual([0, 1]);
        expect(session.movableAtomIndices).toEqual([2, 3]);
        expect(session.currentFrame.x[2]).not.toBeCloseTo(2, 5);
        expect(session.currentFrame.y[3]).not.toBeCloseTo(1, 5);
    });

    it('moves the full A-side fragment for an angle constraint when C is locked', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 1, 0], [0, -1, 0]]);
        const session = createConstraintEditSession({
            kind: 'angle',
            model,
            structure: createStructure(model, 4, [[0, 1], [1, 2], [0, 3]]),
            atomIndices: [0, 1, 2],
        });

        session.setLockedAtomIndex(2);
        session.update(90);

        expect(session.anchorAtomIndices).toEqual([1, 2]);
        expect(session.movableAtomIndices).toEqual([0, 3]);
        expect(session.currentFrame.x[0]).not.toBeCloseTo(0, 5);
        expect(session.currentFrame.x[3]).not.toBeCloseTo(0, 5);
        expect(session.currentFrame.x[2]).toBeCloseTo(2, 5);
    });

    it('moves the full C-side fragment for a dihedral constraint', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'dihedral',
            model,
            structure: createStructure(model, 5, [[0, 1], [1, 2], [2, 3], [3, 4]]),
            atomIndices: [0, 1, 2, 3],
        });

        session.update(90);

        expect(session.movableAtomIndices).toEqual([2, 3, 4]);
        expect(session.currentFrame.z[4]).not.toBeCloseTo(0, 5);
    });

    it('falls back to atom scope when the selected center bond cannot split the graph', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [0.5, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2], [2, 0]]),
            atomIndices: [0, 1],
        });

        expect(session.moveScope).toBe('atom');
        expect(session.movableAtomIndices).toEqual([1]);
        expect(session.isMoveScopeAvailable('atom')).toBe(true);
        expect(session.isMoveScopeAvailable('fragment')).toBe(false);
        expect(() => session.setMoveScope('fragment')).toThrowError('Fragment scope is not available');
    });

    it('supports atom-only scope on a ring when fragment scope cannot split', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [0.5, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2], [2, 0]]),
            atomIndices: [0, 1],
            moveScope: 'atom',
        });

        expect(session.movableAtomIndices).toEqual([1]);
        session.update(2);
        expect(session.currentFrame.x[1]).toBeCloseTo(2, 5);
    });

    it('can switch between fragment and atom scope', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2]]),
            atomIndices: [0, 1],
        });
        expect(session.moveScope).toBe('fragment');
        expect(session.movableAtomIndices).toEqual([1, 2]);

        session.setMoveScope('atom');
        expect(session.moveScope).toBe('atom');
        expect(session.movableAtomIndices).toEqual([1]);
    });

    it('uses terminal atom in dihedral atom scope instead of the axis atom', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'dihedral',
            model,
            structure: createStructure(model, 4, [[0, 1], [1, 2], [2, 3]]),
            atomIndices: [0, 1, 2, 3],
            moveScope: 'atom',
        });

        expect(session.movableAtomIndices).toEqual([3]);
        session.update(90);
        expect(session.currentFrame.z[3]).not.toBeCloseTo(0, 5);
        expect(session.currentFrame.z[2]).toBeCloseTo(0, 5);
    });

    it('supports flexible distance propagation with depth and strength falloff', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 4, [[0, 1], [1, 2], [2, 3]]),
            atomIndices: [0, 1],
            moveScope: 'atom',
            constraintType: 'flexible',
            flexMaxBondDepth: 2,
            flexStrength: 0.5,
        });

        session.update(2);

        expect(session.currentFrame.x[0]).toBeCloseTo(0, 5);
        expect(session.currentFrame.x[1]).toBeCloseTo(2, 5);
        expect(session.currentFrame.x[2]).toBeCloseTo(2.25, 5);
        expect(session.currentFrame.x[3]).toBeCloseTo(3.125, 5);
    });

    it('supports flexible angle propagation', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 1, 0], [3, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'angle',
            model,
            structure: createStructure(model, 4, [[0, 1], [1, 2], [2, 3]]),
            atomIndices: [0, 1, 2],
            moveScope: 'atom',
            constraintType: 'flexible',
            flexMaxBondDepth: 2,
            flexStrength: 0.5,
        });

        session.update(120);

        expect(session.currentFrame.x[2]).not.toBeCloseTo(2, 5);
        expect(session.currentFrame.x[3]).not.toBeCloseTo(3, 5);
        expect(session.currentFrame.x[0]).toBeCloseTo(0, 5);
    });

    it('supports flexible dihedral propagation', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'dihedral',
            model,
            structure: createStructure(model, 5, [[0, 1], [1, 2], [2, 3], [3, 4]]),
            atomIndices: [0, 1, 2, 3],
            moveScope: 'atom',
            constraintType: 'flexible',
            flexMaxBondDepth: 2,
            flexStrength: 0.5,
        });

        session.update(90);

        expect(session.currentFrame.z[3]).not.toBeCloseTo(0, 5);
        expect(session.currentFrame.z[4]).not.toBeCloseTo(0, 5);
        expect(session.currentFrame.z[2]).toBeCloseTo(0, 5);
    });

    it('can switch between rigid and flexible and update flex params', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2]]),
            atomIndices: [0, 1],
            moveScope: 'atom',
        });

        expect(session.constraintType).toBe('rigid');
        session.setConstraintType('flexible');
        session.setFlexParams({ maxBondDepth: 3, strength: 0.7 });
        expect(session.constraintType).toBe('flexible');
        expect(session.flexMaxBondDepth).toBe(3);
        expect(session.flexStrength).toBeCloseTo(0.7, 6);
    });

    it('allows selecting non-bonded atoms for distance by falling back to atom scope', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        const session = createConstraintEditSession({
            kind: 'distance',
            model,
            structure: createStructure(model, 3, [[0, 1], [1, 2]]),
            atomIndices: [0, 2],
        });

        expect(session.moveScope).toBe('atom');
        expect(session.movableAtomIndices).toEqual([2]);

        session.update(3);
        expect(session.currentValue).toBeCloseTo(3, 5);
    });

    it('allows selecting non-bonded atoms for angle by falling back to atom scope', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]);
        const session = createConstraintEditSession({
            kind: 'angle',
            model,
            structure: createStructure(model, 4, [[0, 1], [2, 3]]),
            atomIndices: [0, 1, 2],
        });

        expect(session.moveScope).toBe('atom');
        expect(session.movableAtomIndices).toEqual([2]);

        session.update(120);
        expect(session.currentValue).toBeCloseTo(120, 5);
    });

    it('allows selecting non-bonded atoms for dihedral by falling back to atom scope', () => {
        const model = createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 1], [2, 2, 1]]);
        const session = createConstraintEditSession({
            kind: 'dihedral',
            model,
            structure: createStructure(model, 5, [[0, 1], [3, 4]]),
            atomIndices: [0, 1, 2, 3],
        });

        expect(session.moveScope).toBe('atom');
        expect(session.movableAtomIndices).toEqual([3]);

        session.update(90);
        expect(session.currentValue).toBeCloseTo(90, 5);
    });
});
