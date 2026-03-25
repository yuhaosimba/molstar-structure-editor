import { describe, expect, it } from 'vitest';
import {
    cancelEdit,
    commitEdit,
    enableStructureEditing,
    enterAngleMode,
    enterDihedralMode,
    enterDistanceMode,
    enterMoveMode,
    enterRotateMode,
    registerStructureEditor,
} from '../index';

describe('public api', () => {
    it('exports the public editor helpers', () => {
        expect(typeof registerStructureEditor).toBe('function');
        expect(typeof enableStructureEditing).toBe('function');
        expect(typeof enterMoveMode).toBe('function');
        expect(typeof enterRotateMode).toBe('function');
        expect(typeof enterDistanceMode).toBe('function');
        expect(typeof enterAngleMode).toBe('function');
        expect(typeof enterDihedralMode).toBe('function');
        expect(typeof commitEdit).toBe('function');
        expect(typeof cancelEdit).toBe('function');
    });
});
