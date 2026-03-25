import { describe, expect, it } from 'vitest';
import { pickGizmoHandleAtPoint } from '../gizmo-hit-test';

describe('pickGizmoHandleAtPoint', () => {
    it('prefers translation axes when the pointer is close to a handle segment', () => {
        const handle = pickGizmoHandleAtPoint(
            [0, 0],
            {
                translate: {
                    x: [10, 0],
                    y: [0, 30],
                    z: [-30, 0],
                },
                rotate: {
                    x: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                    y: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                    z: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                },
            },
            [9.8, 0.2],
            { translateThreshold: 2, rotateThreshold: 16 },
        );

        expect(handle).toBe('translate-x');
    });

    it('falls back to rotation handles when the pointer is outside translation thresholds', () => {
        const handle = pickGizmoHandleAtPoint(
            [0, 0],
            {
                translate: {
                    x: [10, 0],
                    y: [0, 10],
                    z: [-10, 0],
                },
                rotate: {
                    x: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                    y: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                    z: [[8, 0], [0, 8], [-8, 0], [0, -8]],
                },
            },
            [8, 1],
            { translateThreshold: 0.5, rotateThreshold: 16 },
        );

        expect(handle).toBe('rotate-x');
    });

    it('matches projected rotation ellipses instead of assuming a perfect screen-space circle', () => {
        const handle = pickGizmoHandleAtPoint(
            [0, 0],
            {
                translate: {
                    x: [24, 0],
                    y: [0, 24],
                    z: [-24, 0],
                },
                rotate: {
                    x: [[12, -2], [8, 6], [0, 9], [-8, 6], [-12, -2], [-8, -7], [0, -10], [8, -7]],
                    y: [[14, 0], [10, 4], [0, 6], [-10, 4], [-14, 0], [-10, -4], [0, -6], [10, -4]],
                    z: [[10, 0], [7, 7], [0, 10], [-7, 7], [-10, 0], [-7, -7], [0, -10], [7, -7]],
                },
            },
            [0, 9],
            { translateThreshold: 4, rotateThreshold: 3 },
        );

        expect(handle).toBe('rotate-x');
    });
});
