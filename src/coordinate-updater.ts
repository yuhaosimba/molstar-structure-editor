import { StateObjectSelector } from 'molstar/lib/mol-state/object';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { Frame } from 'molstar/lib/mol-model/structure';
import { ModelWithCoordinates } from 'molstar/lib/mol-plugin-state/transforms/model';

export class CoordinateUpdater {
    private readonly coordinateNodes = new Map<string, StateObjectSelector<any>>();
    private readonly pendingFrames = new Map<string, Frame>();
    private flushing = false;

    constructor(private readonly plugin: PluginContext) {}

    async ensureCoordinateNode(modelRef: string) {
        const existing = this.coordinateNodes.get(modelRef);
        if (existing) return existing;
        const selector = await this.plugin.build().to(modelRef).insert(ModelWithCoordinates).commit();
        this.coordinateNodes.set(modelRef, selector);
        return selector;
    }

    schedule(modelRef: string, frame: Frame) {
        this.pendingFrames.set(modelRef, frame);
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
