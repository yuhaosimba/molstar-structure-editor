import { describe, expect, it } from 'vitest';
import { StateObjectSelector } from 'molstar/lib/mol-state/object';
import { ModelWithCoordinates } from 'molstar/lib/mol-plugin-state/transforms/model';
import { CoordinateUpdater, snapshotFrame } from '../coordinate-updater';

describe('snapshotFrame', () => {
    it('creates a new frame object for update detection', () => {
        const source = {
            elementCount: 2,
            time: { value: 3, unit: 'step' as const },
            xyzOrdering: { isIdentity: true },
            x: [1, 2],
            y: [3, 4],
            z: [5, 6],
        };

        const copy = snapshotFrame(source as any);

        expect(copy).not.toBe(source);
        expect(copy.x).not.toBe(source.x);
        expect(copy.y).not.toBe(source.y);
        expect(copy.z).not.toBe(source.z);
        expect(copy.x[1]).toBe(2);
        expect(copy.time.value).toBe(3);
    });
});

describe('CoordinateUpdater.ensureCoordinateNode', () => {
    it('reuses an existing ModelWithCoordinates node instead of nesting another decorator', async () => {
        const plugin = {
            state: {
                data: {
                    cells: new Map([
                        ['decorated-model-ref', { transform: { transformer: ModelWithCoordinates } }],
                    ]),
                },
            },
            build() {
                throw new Error('build should not be called when the model ref already points to ModelWithCoordinates');
            },
        } as any;

        const updater = new CoordinateUpdater(plugin);
        const selector = await updater.ensureCoordinateNode('decorated-model-ref');

        expect(selector).toBeInstanceOf(StateObjectSelector);
        expect(selector.ref).toBe('decorated-model-ref');
    });
});
