import { StateObjectSelector } from 'molstar/lib/mol-state/object';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { Frame } from 'molstar/lib/mol-model/structure';
import { ModelWithCoordinates } from 'molstar/lib/mol-plugin-state/transforms/model';

export function snapshotFrame(frame: Frame): Frame {
    return {
        elementCount: frame.elementCount,
        time: { value: frame.time.value, unit: frame.time.unit },
        xyzOrdering: { isIdentity: frame.xyzOrdering.isIdentity },
        x: ArrayBuffer.isView(frame.x) ? (frame.x as Float32Array | Float64Array).slice() : Array.from(frame.x),
        y: ArrayBuffer.isView(frame.y) ? (frame.y as Float32Array | Float64Array).slice() : Array.from(frame.y),
        z: ArrayBuffer.isView(frame.z) ? (frame.z as Float32Array | Float64Array).slice() : Array.from(frame.z),
    };
}

export class CoordinateUpdater {
    private readonly coordinateNodes = new Map<string, StateObjectSelector<any>>();
    private readonly pendingFrames = new Map<string, Frame>();
    private flushing = false;

    constructor(private readonly plugin: PluginContext) {}

    async ensureCoordinateNode(modelRef: string) {
        const existing = this.coordinateNodes.get(modelRef);
        if (existing) return existing;
        const cell = this.plugin.state.data.cells.get(modelRef);
        if (cell?.transform.transformer === ModelWithCoordinates) {
            const selector = new StateObjectSelector(modelRef, this.plugin.state.data);
            this.coordinateNodes.set(modelRef, selector);
            return selector;
        }
        const selector = await this.plugin.build().to(modelRef).insert(ModelWithCoordinates).commit();
        this.coordinateNodes.set(modelRef, selector);
        return selector;
    }

    async updateNow(modelRef: string, frame: Frame) {
        const node = await this.ensureCoordinateNode(modelRef);
        await this.plugin.build().to(node).update({ atomicCoordinateFrame: snapshotFrame(frame) }).commit();
        return node;
    }

    schedule(modelRef: string, frame: Frame) {
        this.pendingFrames.set(modelRef, snapshotFrame(frame));
        if (!this.flushing) void this.flush();
    }

    private async flush() {
        this.flushing = true;
        while (this.pendingFrames.size > 0) {
            const batch = Array.from(this.pendingFrames.entries());
            this.pendingFrames.clear();
            for (const [modelRef, frame] of batch) {
                const node = await this.ensureCoordinateNode(modelRef);
                await this.plugin.build().to(node).update({ atomicCoordinateFrame: frame }).commit();
            }
        }
        this.flushing = false;
    }
}
