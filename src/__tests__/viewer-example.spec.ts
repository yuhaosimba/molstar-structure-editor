import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainTs = fs.readFileSync(
    path.resolve(__dirname, '../../examples/viewer-basic/main.ts'),
    'utf8',
);

describe('viewer example', () => {
    it('uses the expanded layout so the right controls stay visible', () => {
        expect(mainTs).toContain('layoutIsExpanded: true');
        expect(mainTs).toContain("layoutControlsDisplay: 'landscape'");
        expect(mainTs).toContain('viewer.plugin.layout.setProps');
    });
});
