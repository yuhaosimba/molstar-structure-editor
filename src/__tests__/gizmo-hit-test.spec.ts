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
                    x: [8, 0],
                    y: [0, 8],
                    z: [0, -8],
                },
            },
            [8, 1],
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
                    x: [8, 0],
                    y: [0, 8],
                    z: [0, -8],
                },
            },
            [8, 1],
            { translateThreshold: 0.5, rotateThreshold: 16 },
        );

        expect(handle).toBe('rotate-x');
    });
});
