import { describe, expect, it } from 'vitest';
import {
    applyAngleConstraint,
    applyDihedralConstraint,
    applyDistanceConstraint,
    getFlexibleWeight,
    measureAngle,
    measureDihedral,
    measureDistance,
    type MutableFrame,
} from '../constraint-geometry';

function createFrame(points: Array<[number, number, number]>): MutableFrame {
    return {
        elementCount: points.length,
        time: { value: 0, unit: 'step' },
        xyzOrdering: { isIdentity: true },
        x: Float32Array.from(points.map(p => p[0])),
        y: Float32Array.from(points.map(p => p[1])),
        z: Float32Array.from(points.map(p => p[2])),
    };
}

describe('constraint geometry measurements', () => {
    it('measures distance, angle, and dihedral from a frame', () => {
        const frame = createFrame([
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [1, 1, 1],
        ]);

        expect(measureDistance(frame, [0, 1])).toBeCloseTo(1, 5);
        expect(measureAngle(frame, [0, 1, 2])).toBeCloseTo(90, 5);
        expect(measureDihedral(frame, [0, 1, 2, 3])).toBeCloseTo(-90, 5);
    });
});

describe('flexible weight', () => {
    it('uses exponential falloff by bond depth', () => {
        expect(getFlexibleWeight(0, 0.5)).toBeCloseTo(0.5, 6);
        expect(getFlexibleWeight(1, 0.5)).toBeCloseTo(0.25, 6);
        expect(getFlexibleWeight(2, 0.5)).toBeCloseTo(0.125, 6);
    });

    it('clamps invalid inputs', () => {
        expect(getFlexibleWeight(-1, 0.8)).toBe(0);
        expect(getFlexibleWeight(1, 2)).toBeCloseTo(0.5, 6);
        expect(getFlexibleWeight(1, -1)).toBe(0);
    });
});

describe('constraint geometry updates', () => {
    it('applies a distance constraint by moving the last atom', () => {
        const frame = createFrame([
            [0, 0, 0],
            [1, 0, 0],
        ]);

        applyDistanceConstraint(frame, [0, 1], [1], 2);

        expect(measureDistance(frame, [0, 1])).toBeCloseTo(2, 5);
        expect(frame.x[0]).toBeCloseTo(0, 5);
    });

    it('applies a distance constraint to all movable atoms in the fragment', () => {
        const frame = createFrame([
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
        ]);

        applyDistanceConstraint(frame, [0, 1], [1, 2], 2);

        expect(frame.x[1]).toBeCloseTo(2, 5);
        expect(frame.x[2]).toBeCloseTo(3, 5);
    });

    it('applies an angle constraint by rotating the last atom around the center', () => {
        const frame = createFrame([
            [0, 0, 0],
            [1, 0, 0],
            [2, 1, 0],
        ]);

        applyAngleConstraint(frame, [0, 1, 2], [2], 90);

        expect(measureAngle(frame, [0, 1, 2])).toBeCloseTo(90, 5);
        expect(frame.x[2]).toBeCloseTo(1, 5);
    });

    it('applies a dihedral constraint by rotating the last atom around the middle bond', () => {
        const frame = createFrame([
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [2, 1, 0],
        ]);

        applyDihedralConstraint(frame, [0, 1, 2, 3], [3], 90);

        expect(measureDihedral(frame, [0, 1, 2, 3])).toBeCloseTo(90, 5);
    });

    it('throws on degenerate angle input', () => {
        const frame = createFrame([
            [0, 0, 0],
            [0, 0, 0],
            [1, 0, 0],
        ]);

        expect(() => applyAngleConstraint(frame, [0, 1, 2], [2], 120)).toThrowError('Cannot edit angle');
    });
});
