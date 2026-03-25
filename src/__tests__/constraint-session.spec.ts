import { describe, expect, it } from 'vitest';
import { Model } from 'molstar/lib/mol-model/structure';
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

describe('constraint edit sessions', () => {
    it('creates a distance session and updates the current value', () => {
        const session = createConstraintEditSession({
            kind: 'distance',
            model: createModel([[0, 0, 0], [1, 0, 0]]),
            atomIndices: [0, 1],
        });

        expect(session.originalValue).toBeCloseTo(1, 5);

        session.update(2);

        expect(session.currentValue).toBeCloseTo(2, 5);
        expect(session.currentFrame.x[1]).toBeCloseTo(2, 5);
    });

    it('cancels back to the base frame and commits the edited frame', () => {
        const session = createConstraintEditSession({
            kind: 'distance',
            model: createModel([[0, 0, 0], [1, 0, 0]]),
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
        const session = createConstraintEditSession({
            kind: 'distance',
            model: createModel([[0, 0, 0], [1, 0, 0]]),
            atomIndices: [0, 1],
        });

        session.setLockedAtomIndex(1);
        session.update(2);

        expect(session.anchorAtomIndices).toEqual([1]);
        expect(session.movableAtomIndices).toEqual([0]);
        expect(session.currentFrame.x[1]).toBeCloseTo(1, 5);
        expect(session.currentFrame.x[0]).toBeCloseTo(-1, 5);
    });

    it('can switch the locked side for an angle constraint', () => {
        const session = createConstraintEditSession({
            kind: 'angle',
            model: createModel([[0, 0, 0], [1, 0, 0], [2, 1, 0]]),
            atomIndices: [0, 1, 2],
        });

        session.setLockedAtomIndex(2);
        session.update(90);

        expect(session.anchorAtomIndices).toEqual([1, 2]);
        expect(session.movableAtomIndices).toEqual([0]);
        expect(session.currentValue).toBeCloseTo(90, 5);
        expect(session.currentFrame.x[2]).toBeCloseTo(2, 5);
        expect(session.currentFrame.x[0]).not.toBeCloseTo(0, 5);
    });

    it('can switch the locked side for a dihedral constraint', () => {
        const session = createConstraintEditSession({
            kind: 'dihedral',
            model: createModel([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]]),
            atomIndices: [0, 1, 2, 3],
        });

        session.setLockedAtomIndex(3);
        session.update(90);

        expect(session.anchorAtomIndices).toEqual([1, 2, 3]);
        expect(session.movableAtomIndices).toEqual([0]);
        expect(session.currentFrame.x[3]).toBeCloseTo(2, 5);
        expect(session.currentFrame.z[0]).not.toBeCloseTo(0, 5);
    });
});
