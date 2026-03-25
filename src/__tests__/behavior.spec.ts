import { describe, expect, it } from 'vitest';
import { projectViewportPointToClientPoint } from '../behavior';

describe('projectViewportPointToClientPoint', () => {
    it('converts viewport coordinates to client coordinates with top-left browser origin', () => {
        const point = projectViewportPointToClientPoint(
            [950, 552, 0, 1],
            { left: 0, top: 0, width: 1440, height: 1000 },
            { width: 1440, height: 1000 },
        );

        expect(point[0]).toBe(950);
        expect(point[1]).toBe(448);
    });
});
