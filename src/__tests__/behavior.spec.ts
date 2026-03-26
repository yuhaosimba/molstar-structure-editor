import { describe, expect, it } from 'vitest';
import { DEFAULT_GIZMO_SCALE, projectViewportPointToClientPoint, toRepresentationPresetId } from '../behavior';

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

describe('DEFAULT_GIZMO_SCALE', () => {
    it('keeps gizmo sizing fixed instead of camera-distance dependent', () => {
        expect(DEFAULT_GIZMO_SCALE).toBeGreaterThan(0);
        expect(DEFAULT_GIZMO_SCALE).toBe(2.5);
    });
});

describe('toRepresentationPresetId', () => {
    it('maps quick style presets to representation preset ids', () => {
        expect(toRepresentationPresetId('default')).toBe('auto');
        expect(toRepresentationPresetId('cartoon')).toBe('polymer-and-ligand');
        expect(toRepresentationPresetId('ball-and-stick')).toBe('atomic-detail');
        expect(toRepresentationPresetId('spacefill')).toBe('illustrative');
        expect(toRepresentationPresetId('surface')).toBe('molecular-surface');
    });
});
