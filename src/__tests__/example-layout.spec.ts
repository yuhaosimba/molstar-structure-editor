import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const exampleHtml = fs.readFileSync(
    path.resolve(__dirname, '../../examples/viewer-basic/index.html'),
    'utf8',
);

describe('viewer example layout', () => {
    it('locks the document viewport to avoid scrollbar flicker', () => {
        expect(exampleHtml).toContain('overflow: hidden');
        expect(exampleHtml).toContain('#app {');
        expect(exampleHtml).toContain('position: absolute');
        expect(exampleHtml).toContain('inset: 0');
    });
});
