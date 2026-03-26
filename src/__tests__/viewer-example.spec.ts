import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainTs = fs.readFileSync(
    path.resolve(__dirname, '../../examples/viewer-basic/main.ts'),
    'utf8',
);
const behaviorTs = fs.readFileSync(
    path.resolve(__dirname, '../behavior.ts'),
    'utf8',
);

describe('viewer example', () => {
    it('uses the expanded layout so the right controls stay visible', () => {
        expect(mainTs).toContain('layoutIsExpanded: true');
        expect(mainTs).toContain("layoutControlsDisplay: 'landscape'");
        expect(mainTs).toContain('viewer.plugin.layout.setProps');
    });

    it('offers a Ball & Stick quick style in the editor toolbar', () => {
        expect(behaviorTs).toContain('Ball & Stick');
    });

    it('uses a unified Transform entry instead of separate Move and Rotate toolbar modes', () => {
        expect(behaviorTs).toContain('Transform');
        expect(behaviorTs).not.toContain("['Move', () => this.enterMode('move')]");
        expect(behaviorTs).not.toContain("['Rotate', () => this.enterMode('rotate')]");
    });

    it('offers distance, angle, and dihedral tools in the editor toolbar', () => {
        expect(behaviorTs).toContain('Distance');
        expect(behaviorTs).toContain('Angle');
        expect(behaviorTs).toContain('Dihedral');
    });

    it('renders a lock selector for constraint editing', () => {
        expect(behaviorTs).toContain('Locked Atom');
        expect(behaviorTs).toContain('Move Scope');
    });

    it('passes structure into constraint sessions for graph-based fragment resolution', () => {
        expect(behaviorTs).toContain('structure,');
    });

    it('shows fragment-oriented summary text in the constraint panel', () => {
        expect(behaviorTs).toContain('Locked side atoms:');
        expect(behaviorTs).toContain("const movableLabel = this.constraintSession.moveScope === 'fragment' ? 'Movable fragment atoms' : 'Movable atoms'");
    });

    it('includes a local small-molecule ligand example for interaction testing', () => {
        expect(mainTs).toContain('benzene.mol');
        expect(mainTs).toContain('biphenyl.mol');
        expect(mainTs).toContain('Benzene');
        expect(mainTs).toContain('Biphenyl');
    });
});
