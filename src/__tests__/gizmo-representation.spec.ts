import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { getRingTransform } from '../gizmo-representation';

function getRingNormal(transform: Mat4) {
    const pointA = Vec3.transformMat4(Vec3(), Vec3.create(1, 0, 0), transform);
    const pointB = Vec3.transformMat4(Vec3(), Vec3.create(0, 0, 1), transform);
    return Vec3.normalize(Vec3(), Vec3.cross(Vec3(), pointA, pointB));
}

describe('getRingTransform', () => {
    it('maps x/y/z rotation rings onto distinct planes for the three axes', () => {
        const xNormal = getRingNormal(getRingTransform(Vec3.unitX, Vec3.zero(), 1));
        const yNormal = getRingNormal(getRingTransform(Vec3.unitY, Vec3.zero(), 1));
        const zNormal = getRingNormal(getRingTransform(Vec3.unitZ, Vec3.zero(), 1));

        expect(Math.abs(Vec3.dot(xNormal, Vec3.unitX))).toBeCloseTo(1, 5);
        expect(Math.abs(Vec3.dot(yNormal, Vec3.unitY))).toBeCloseTo(1, 5);
        expect(Math.abs(Vec3.dot(zNormal, Vec3.unitZ))).toBeCloseTo(1, 5);
    });
});
