import { Subscription } from 'rxjs';
import { ShapeGroup } from 'molstar/lib/mol-model/shape';
import { StructureElement } from 'molstar/lib/mol-model/structure';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { Binding } from 'molstar/lib/mol-util/binding';
import { Mat4, Vec2, Vec3, Vec4 } from 'molstar/lib/mol-math/linear-algebra';
import { StructureEditorCommands } from './commands';
import { CoordinateUpdater } from './coordinate-updater';
import { GizmoGroupIds, GizmoHandleId, StructureEditorGizmo3D } from './gizmo-representation';
import { EditKind, EditSession, EditState, applyRotationStep, applyTranslationStep, cancelSession, commitSession, createEditSession } from './session';

export type StructureEditorOptions = {
    autoAttach?: boolean
    showToolbar?: boolean
    maxRealtimeAtoms?: number
    realtimeUpdateMode?: 'always'
};

type TrackballBindings = NonNullable<NonNullable<PluginContext['canvas3d']>['attribs']['trackball']>['bindings'];

type DragOperation = {
    handle: GizmoHandleId
    kind: EditKind
};

type EditorStore = {
    controller?: StructureEditorController
};

const StoreKey = '__molstarStructureEditor__';
const EmptyBinding = Binding.Empty;

function getStore(plugin: PluginContext): EditorStore {
    const root = plugin.customState as Record<string, EditorStore | undefined>;
    if (!root[StoreKey]) root[StoreKey] = {};
    return root[StoreKey]!;
}

function showToast(plugin: PluginContext, title: string, message: string, timeoutMs = 2500) {
    PluginCommands.Toast.Show(plugin, {
        key: 'structure-editor-toast',
        title,
        message,
        timeoutMs
    });
}

function getSelectionEntry(plugin: PluginContext) {
    const entries = Array.from(plugin.managers.structure.selection.entries.values())
        .filter(entry => !!entry.structure);
    if (entries.length === 0) return;
    if (entries.length > 1) {
        throw new Error('Editing selections spanning multiple structures is not supported in v1.');
    }
    return entries[0];
}

function cloneBindings(bindings: TrackballBindings): TrackballBindings {
    return { ...bindings };
}

function getDisabledBindings(bindings: TrackballBindings): TrackballBindings {
    return {
        ...bindings,
        dragRotate: EmptyBinding,
        dragRotateZ: EmptyBinding,
        dragPan: EmptyBinding,
        dragZoom: EmptyBinding,
        dragFocus: EmptyBinding,
        dragFocusZoom: EmptyBinding,
    };
}

function getScreenPoint(plugin: PluginContext, point: Vec3) {
    const projected = plugin.canvas3d!.camera.project(Vec4(), point);
    return Vec2.create(projected[0], projected[1]);
}

function getCurrentAnchor(session: EditSession) {
    return Vec3.clone(session.currentCentroid);
}

function getHandleAxis(handle: GizmoHandleId) {
    if (handle.endsWith('x')) return Vec3.unitX;
    if (handle.endsWith('y')) return Vec3.unitY;
    return Vec3.unitZ;
}

function inferHandle(current: any): GizmoHandleId | undefined {
    if (!ShapeGroup.isLoci(current.loci)) return;
    const sourceData = current.loci.shape.sourceData as { tag?: string } | undefined;
    if (sourceData?.tag !== 'structure-editor-gizmo') return;
    const group = current.loci.groups[0];
    if (!group) return;
    const first = group.ids[0];
    return GizmoGroupIds[first];
}

export class StructureEditorController {
    private readonly subs: { unsubscribe(): void }[] = [];
    private readonly updater: CoordinateUpdater;
    private gizmoRef: string | undefined = void 0;
    private toolbar: HTMLDivElement | undefined = void 0;
    private session: EditSession | undefined = void 0;
    private sessionModelRef: string | undefined = void 0;
    private state: EditState = 'idle';
    private dragOperation: DragOperation | undefined = void 0;
    private rafHandle = 0;
    private pendingFrame = false;
    private previousSelectionMode = false;
    private previousBindings: TrackballBindings | undefined = void 0;

    constructor(private readonly plugin: PluginContext, private readonly options: Required<StructureEditorOptions>) {
        this.updater = new CoordinateUpdater(plugin);
        this.subs.push(
            StructureEditorCommands.EnterMoveMode.subscribe(plugin, () => this.enterMode('move')),
            StructureEditorCommands.EnterRotateMode.subscribe(plugin, () => this.enterMode('rotate')),
            StructureEditorCommands.CommitEdit.subscribe(plugin, () => this.commit()),
            StructureEditorCommands.CancelEdit.subscribe(plugin, () => this.cancel()),
            plugin.behaviors.interaction.click.subscribe(event => this.onClick(event)),
            plugin.behaviors.interaction.drag.subscribe(event => this.onDrag(event)),
            plugin.behaviors.interaction.key.subscribe(event => this.onKey(event)),
        );

        if (this.options.showToolbar) this.mountToolbar();
    }

    dispose() {
        for (const sub of this.subs) sub.unsubscribe();
        this.destroyToolbar();
        void this.hideGizmo();
        this.restoreInteractivity();
    }

    async enterMode(kind: EditKind) {
        try {
            const entry = getSelectionEntry(this.plugin);
            if (!entry?.selection || !entry.structure) {
                showToast(this.plugin, 'Structure Editor', 'Select atoms before entering edit mode.');
                return;
            }

            const selected = entry.selection;
            const parentCell = this.plugin.helpers.substructureParent.get(entry.structure, true);
            if (!parentCell) {
                showToast(this.plugin, 'Structure Editor', 'Could not resolve the selected structure.');
                return;
            }

            const hierarchy = this.plugin.managers.structure.hierarchy.current;
            const structureRef = hierarchy.structures.find(s => s.cell.transform.ref === parentCell.transform.ref);
            const modelRef = structureRef?.model?.cell.transform.ref;
            if (!structureRef || !modelRef || !structureRef.cell.obj?.data.model) {
                showToast(this.plugin, 'Structure Editor', 'Could not resolve the selected model.');
                return;
            }

            if (!selected.elements.every(e => Mat4.isIdentity(e.unit.conformation.operator.matrix))) {
                showToast(this.plugin, 'Structure Editor', 'Selections on transformed assembly copies are not supported in v1.');
                return;
            }

            this.session = createEditSession({
                model: structureRef.cell.obj.data.model,
                structure: entry.structure,
                selection: selected,
                maxRealtimeAtoms: this.options.maxRealtimeAtoms,
            });
            this.sessionModelRef = modelRef;

            if (this.session.atomIndices.length > this.options.maxRealtimeAtoms) {
                showToast(this.plugin, 'Structure Editor', `Large selection (${this.session.atomIndices.length} atoms). Realtime updates will be throttled to animation frames.`);
            }

            await this.updater.ensureCoordinateNode(modelRef);
            await this.showGizmo();
            this.setState(kind === 'move' ? 'armed-move' : 'armed-rotate');
            this.disableInteractivity();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start the edit session.';
            showToast(this.plugin, 'Structure Editor', message);
        }
    }

    async commit() {
        if (!this.session) return;
        commitSession(this.session);
        await this.pushFrame();
        this.finishSession('idle');
    }

    async cancel() {
        if (!this.session) return;
        cancelSession(this.session);
        await this.pushFrame();
        this.finishSession('cancelled');
    }

    private finishSession(state: EditState) {
        this.setState(state);
        this.dragOperation = void 0;
        void this.hideGizmo();
        this.restoreInteractivity();
        this.session = void 0;
        this.sessionModelRef = void 0;
        this.setState('idle');
    }

    private setState(state: EditState) {
        this.state = state;
        this.syncToolbar();
    }

    private disableInteractivity() {
        this.previousSelectionMode = this.plugin.selectionMode;
        this.plugin.selectionMode = true;
        this.previousBindings = cloneBindings(this.plugin.canvas3d!.attribs.trackball.bindings);
        this.plugin.canvas3d!.setAttribs({ trackball: { bindings: getDisabledBindings(this.previousBindings) } });
    }

    private restoreInteractivity() {
        if (this.previousBindings && this.plugin.canvas3d) {
            this.plugin.canvas3d.setAttribs({ trackball: { bindings: this.previousBindings } });
        }
        this.previousBindings = void 0;
        this.plugin.selectionMode = this.previousSelectionMode;
    }

    private async pushFrame() {
        if (!this.session || !this.sessionModelRef) return;
        this.updater.schedule(this.sessionModelRef, this.session.currentFrame);
        await this.showGizmo();
    }

    private scheduleFrame() {
        if (this.pendingFrame) return;
        this.pendingFrame = true;
        this.rafHandle = requestAnimationFrame(() => {
            this.pendingFrame = false;
            void this.pushFrame();
        });
    }

    private getGizmoScale() {
        if (!this.plugin.canvas3d || !this.session) return 1;
        const anchor = getCurrentAnchor(this.session);
        return this.plugin.canvas3d.camera.getPixelSize(anchor) * 90;
    }

    private async showGizmo() {
        if (!this.session) return;
        const params = {
            visible: true,
            anchor: getCurrentAnchor(this.session),
            scale: this.getGizmoScale(),
            activeHandle: this.dragOperation?.handle ?? '',
        };

        if (this.gizmoRef) {
            await this.plugin.build().to(this.gizmoRef).update(params).commit();
            return;
        }

        const update = this.plugin.build().toRoot()
            .apply(StructureEditorGizmo3D, params)
            .apply(StateTransforms.Representation.ShapeRepresentation3D, {
                alpha: 1,
                doubleSided: true,
                xrayShaded: true,
                ignoreLight: true,
            });

        await update.commit();
        this.gizmoRef = update.selector.cell?.transform.parent;
    }

    private async hideGizmo() {
        if (!this.gizmoRef) return;
        const ref = this.gizmoRef;
        this.gizmoRef = void 0;
        await this.plugin.build().delete(ref).commit();
    }

    private onClick(event: any) {
        if (!this.session) return;
        const handle = inferHandle(event.current);
        if (!handle) return;
        const kind: EditKind = handle.startsWith('translate') ? 'move' : 'rotate';
        this.dragOperation = { handle, kind };
        this.setState(kind === 'move' ? 'dragging-translate' : 'dragging-rotate');
        void this.showGizmo();
    }

    private onDrag(event: any) {
        if (!this.session || !this.dragOperation || !this.plugin.canvas3d) return;
        const start = event.pageStart as Vec2;
        const end = event.pageEnd as Vec2;

        if (this.dragOperation.kind === 'move') {
            const axis = getHandleAxis(this.dragOperation.handle);
            const distance = this.projectTranslationDistance(axis, start, end);
            applyTranslationStep(this.session, axis, distance);
        } else {
            const axis = getHandleAxis(this.dragOperation.handle);
            const angle = this.projectRotationAngle(axis, start, end);
            applyRotationStep(this.session, axis, angle);
        }
        this.scheduleFrame();
    }

    private onKey(event: { key?: string; code?: string }) {
        if (event.key === 'Escape') {
            void this.cancel();
        } else if (event.key === 'Enter') {
            void this.commit();
        }
    }

    private projectTranslationDistance(axis: Vec3, start: Vec2, end: Vec2) {
        const anchor = getCurrentAnchor(this.session!);
        const p0 = getScreenPoint(this.plugin, anchor);
        const p1 = getScreenPoint(this.plugin, Vec3.add(Vec3(), anchor, axis));
        const axisScreen = Vec2.sub(Vec2(), p1, p0);
        const delta = Vec2.sub(Vec2(), end, start);
        const axisScreenLength = Math.max(Vec2.magnitude(axisScreen), 1e-6);
        return (delta[0] * axisScreen[0] + delta[1] * axisScreen[1]) / (axisScreenLength * axisScreenLength);
    }

    private projectRotationAngle(axis: Vec3, start: Vec2, end: Vec2) {
        const anchor = getCurrentAnchor(this.session!);
        const screenAnchor = getScreenPoint(this.plugin, anchor);
        const a = Vec2.sub(Vec2(), start, screenAnchor);
        const b = Vec2.sub(Vec2(), end, screenAnchor);
        const cross = a[0] * b[1] - a[1] * b[0];
        const dot = a[0] * b[0] + a[1] * b[1];
        const viewDir = Vec3.normalize(Vec3(), Vec3.sub(Vec3(), this.plugin.canvas3d!.camera.state.target, this.plugin.canvas3d!.camera.state.position));
        const sign = Vec3.dot(viewDir, axis) >= 0 ? -1 : 1;
        return Math.atan2(cross, dot) * sign;
    }

    private mountToolbar() {
        const context = this.plugin.canvas3dContext;
        const canvas = context && context.canvas ? context.canvas : void 0;
        const host = canvas?.parentElement;
        if (!host) return;

        const toolbar = document.createElement('div');
        toolbar.style.position = 'absolute';
        toolbar.style.top = '12px';
        toolbar.style.left = '12px';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '8px';
        toolbar.style.padding = '8px';
        toolbar.style.background = 'rgba(0, 0, 0, 0.65)';
        toolbar.style.borderRadius = '8px';
        toolbar.style.zIndex = '5';

        const buttons = [
            ['Move', () => this.enterMode('move')],
            ['Rotate', () => this.enterMode('rotate')],
            ['Apply', () => this.commit()],
            ['Cancel', () => this.cancel()],
        ] as const;

        for (const [label, action] of buttons) {
            const button = document.createElement('button');
            button.textContent = label;
            button.style.border = 'none';
            button.style.padding = '6px 10px';
            button.style.borderRadius = '6px';
            button.style.cursor = 'pointer';
            button.addEventListener('click', () => void action());
            toolbar.appendChild(button);
        }

        host.style.position ||= 'relative';
        host.appendChild(toolbar);
        this.toolbar = toolbar;
        this.syncToolbar();
    }

    private destroyToolbar() {
        this.toolbar?.remove();
        this.toolbar = void 0;
    }

    private syncToolbar() {
        if (!this.toolbar) return;
        const buttons = Array.from(this.toolbar.querySelectorAll('button'));
        const hasSession = !!this.session;
        if (buttons[2]) (buttons[2] as HTMLButtonElement).disabled = !hasSession;
        if (buttons[3]) (buttons[3] as HTMLButtonElement).disabled = !hasSession;
    }
}

export function getOrCreateStructureEditor(plugin: PluginContext, options: StructureEditorOptions = {}) {
    const store = getStore(plugin);
    if (!store.controller) {
        store.controller = new StructureEditorController(plugin, {
            autoAttach: options.autoAttach ?? false,
            showToolbar: options.showToolbar ?? true,
            maxRealtimeAtoms: options.maxRealtimeAtoms ?? 512,
            realtimeUpdateMode: options.realtimeUpdateMode ?? 'always',
        });
    }
    return store.controller;
}
