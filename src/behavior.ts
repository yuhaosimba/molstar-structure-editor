import { Subscription } from 'rxjs';
import { StructureElement } from 'molstar/lib/mol-model/structure';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { setSubtreeVisibility } from 'molstar/lib/mol-plugin/behavior/static/state';
import { PresetStructureRepresentations } from 'molstar/lib/mol-plugin-state/builder/structure/representation-preset';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { PluginConfig } from 'molstar/lib/mol-plugin/config';
import { Binding } from 'molstar/lib/mol-util/binding';
import { Mat4, Vec2, Vec3, Vec4 } from 'molstar/lib/mol-math/linear-algebra';
import { StructureEditorCommands } from './commands';
import { CoordinateUpdater } from './coordinate-updater';
import { getClosestPolylineSegment, Point as ScreenPoint, pickGizmoHandleAtPoint } from './gizmo-hit-test';
import { GizmoHandleId, StructureEditorGizmo3D } from './gizmo-representation';
import { EditKind, EditSession, EditState, applyRotationStep, applyTranslationStep, cancelSession, commitSession, createEditSession } from './session';
import { getSingleSelectionEntry } from './selection-target';

export type StructureEditorOptions = {
    autoAttach?: boolean
    showToolbar?: boolean
    maxRealtimeAtoms?: number
    realtimeUpdateMode?: 'always'
};

export const DEFAULT_GIZMO_SCALE = 2.5;

type TrackballBindings = NonNullable<NonNullable<PluginContext['canvas3d']>['attribs']['trackball']>['bindings'];

type DragOperation = {
    handle: GizmoHandleId
    kind: EditKind
};

type Point2 = [number, number];
type RectLike = { left: number; top: number; width: number; height: number };
type SizeLike = { width: number; height: number };

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
    return getSingleSelectionEntry(plugin.managers.structure.selection.entries);
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

export function projectViewportPointToClientPoint(projected: Vec4 | [number, number, number, number], rect: RectLike, canvas: SizeLike): Point2 {
    const scaleX = rect.width / Math.max(canvas.width, 1);
    const scaleY = rect.height / Math.max(canvas.height, 1);
    return [
        rect.left + projected[0] * scaleX,
        rect.top + (canvas.height - projected[1]) * scaleY,
    ];
}

function getCanvasClientPoint(plugin: PluginContext, point: Vec3): Point2 {
    const canvas = plugin.canvas3dContext?.canvas;
    if (!canvas) return [0, 0];
    const projected = plugin.canvas3d!.camera.project(Vec4(), point);
    const rect = canvas.getBoundingClientRect();
    return projectViewportPointToClientPoint(projected, rect, canvas);
}

function toVec2(point: Point2) {
    return Vec2.create(point[0], point[1]);
}

function getCurrentAnchor(session: EditSession) {
    return Vec3.clone(session.currentCentroid);
}

function getHandleAxis(handle: GizmoHandleId) {
    if (handle.endsWith('x')) return Vec3.unitX;
    if (handle.endsWith('y')) return Vec3.unitY;
    return Vec3.unitZ;
}

function getRingBasis(axis: Vec3): [Vec3, Vec3] {
    if (axis[0] === 1) return [Vec3.unitY, Vec3.unitZ];
    if (axis[1] === 1) return [Vec3.unitZ, Vec3.unitX];
    return [Vec3.unitX, Vec3.unitY];
}

function sampleProjectedRingPoints(plugin: PluginContext, anchor: Vec3, axis: Vec3, radius: number, segmentCount = 64) {
    const [basisA, basisB] = getRingBasis(axis);
    const points: ScreenPoint[] = [];
    for (let i = 0; i < segmentCount; i++) {
        const t = (i / segmentCount) * Math.PI * 2;
        const point = Vec3.clone(anchor);
        Vec3.scaleAndAdd(point, point, basisA, Math.cos(t) * radius);
        Vec3.scaleAndAdd(point, point, basisB, Math.sin(t) * radius);
        points.push(getCanvasClientPoint(plugin, point));
    }
    return points;
}

function getProjectedGizmoPoints(plugin: PluginContext, session: EditSession, scale: number) {
    const anchor = getCurrentAnchor(session);
    const axisOffset = (axis: Vec3, distance: number) => Vec3.add(Vec3(), anchor, Vec3.scale(Vec3(), axis, distance));
    const translateX = getCanvasClientPoint(plugin, axisOffset(Vec3.unitX, scale));
    const translateY = getCanvasClientPoint(plugin, axisOffset(Vec3.unitY, scale));
    const translateZ = getCanvasClientPoint(plugin, axisOffset(Vec3.unitZ, scale));
    const rotateRadius = scale * 0.9;
    const rotateX = sampleProjectedRingPoints(plugin, anchor, Vec3.unitX, rotateRadius);
    const rotateY = sampleProjectedRingPoints(plugin, anchor, Vec3.unitY, rotateRadius);
    const rotateZ = sampleProjectedRingPoints(plugin, anchor, Vec3.unitZ, rotateRadius);
    return {
        center: getCanvasClientPoint(plugin, anchor),
        translate: {
            x: translateX,
            y: translateY,
            z: translateZ,
        },
        rotate: {
            x: rotateX,
            y: rotateY,
            z: rotateZ,
        },
    };
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
    private dragPointerId: number | undefined = void 0;
    private dragLastPoint: Point2 | undefined = void 0;
    private rafHandle = 0;
    private pendingFrame = false;
    private previousSelectionMode = false;
    private previousBindings: TrackballBindings | undefined = void 0;
    private pointerHost: HTMLElement | undefined = void 0;
    private lastPickedLoci: StructureElement.Loci | undefined = void 0;
    private sourceStructureRef: string | undefined = void 0;
    private previewStructureRef: string | undefined = void 0;

    constructor(private readonly plugin: PluginContext, private readonly options: Required<StructureEditorOptions>) {
        this.updater = new CoordinateUpdater(plugin);
        this.subs.push(
            StructureEditorCommands.EnterMoveMode.subscribe(plugin, () => this.enterTransformMode()),
            StructureEditorCommands.EnterRotateMode.subscribe(plugin, () => this.enterTransformMode()),
            StructureEditorCommands.CommitEdit.subscribe(plugin, () => this.commit()),
            StructureEditorCommands.CancelEdit.subscribe(plugin, () => this.cancel()),
            plugin.behaviors.interaction.click.subscribe(event => this.onClick(event)),
            plugin.behaviors.interaction.key.subscribe(event => this.onKey(event)),
        );

        if (this.options.showToolbar) this.mountToolbar();
    }

    dispose() {
        for (const sub of this.subs) sub.unsubscribe();
        this.destroyToolbar();
        this.detachPointerEvents();
        void this.hideGizmo();
        this.restoreInteractivity();
    }

    async enterTransformMode() {
        try {
            const selectedEntry = getSelectionEntry(this.plugin);
            const entry = selectedEntry?.entry as any;
            const selection = (entry?.selection ?? entry?._selection) as any;
            const structureRef = (selection?.structure ?? entry?.structure ?? entry?._structure?.structure) as any;
            if (!selectedEntry?.ref || !selection || !structureRef) {
                showToast(this.plugin, 'Structure Editor', 'Select atoms before entering edit mode.');
                return;
            }

            const model = structureRef.model;
            const hierarchyStructure = this.plugin.managers.structure.hierarchy.current.structures.find((current: any) => current.model?.cell?.obj?.data?.id === model.id);
            const modelRef = hierarchyStructure?.model?.cell?.transform?.ref;
            const sourceStructureRef = hierarchyStructure?.cell?.transform?.ref;
            if (!model || !modelRef || !sourceStructureRef) {
                showToast(this.plugin, 'Structure Editor', 'Could not resolve the selected structure.');
                return;
            }

            const effectiveSelection = selection.elements.length > 0 ? selection : this.lastPickedLoci;
            if (!effectiveSelection || effectiveSelection.structure?.model?.id !== model.id) {
                showToast(this.plugin, 'Structure Editor', 'Select atoms before entering edit mode.');
                return;
            }

            if (!effectiveSelection.elements.every((e: any) => Mat4.isIdentity(e.unit.conformation.operator.matrix))) {
                showToast(this.plugin, 'Structure Editor', 'Selections on transformed assembly copies are not supported in v1.');
                return;
            }

            this.session = createEditSession({
                model,
                structure: structureRef,
                selection: effectiveSelection,
                maxRealtimeAtoms: this.options.maxRealtimeAtoms,
            });
            this.sessionModelRef = modelRef;
            this.sourceStructureRef = sourceStructureRef;

            if (this.session.atomIndices.length > this.options.maxRealtimeAtoms) {
                showToast(this.plugin, 'Structure Editor', `Large selection (${this.session.atomIndices.length} atoms). Realtime updates will be throttled to animation frames.`);
            }

            const coordinateNode = await this.updater.updateNow(modelRef, this.session.currentFrame);
            await this.showEditableStructure(sourceStructureRef, coordinateNode.ref);
            await this.showGizmo();
            this.attachPointerEvents();
            this.setState('armed-transform');
            this.previousSelectionMode = this.plugin.selectionMode;
            this.plugin.selectionMode = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start the edit session.';
            showToast(this.plugin, 'Structure Editor', message);
        }
    }

    async commit() {
        if (!this.session) return;
        commitSession(this.session);
        await this.pushFrame();
        if (this.sourceStructureRef) {
            await this.plugin.build().delete(this.sourceStructureRef).commit();
        }
        this.sourceStructureRef = this.previewStructureRef;
        this.previewStructureRef = void 0;
        this.finishSession('idle');
    }

    async cancel() {
        if (!this.session) return;
        cancelSession(this.session);
        await this.pushFrame();
        await this.cleanupEditableStructure(true);
        this.finishSession('cancelled');
    }

    private finishSession(state: EditState) {
        this.setState(state);
        this.dragOperation = void 0;
        this.dragPointerId = void 0;
        this.dragLastPoint = void 0;
        void this.hideGizmo();
        this.detachPointerEvents();
        this.restoreInteractivity();
        this.session = void 0;
        this.sessionModelRef = void 0;
        this.sourceStructureRef = void 0;
        this.previewStructureRef = void 0;
        this.setState('idle');
    }

    private setState(state: EditState) {
        this.state = state;
        this.syncToolbar();
    }

    private disableInteractivity() {
        if (this.previousBindings || !this.plugin.canvas3d) return;
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

    private async showEditableStructure(sourceStructureRef: string, coordinateModelRef: string) {
        if (!this.previewStructureRef) {
            setSubtreeVisibility(this.plugin.state.data, sourceStructureRef, true);
            const structure = await this.plugin.builders.structure.createStructure(coordinateModelRef);
            await this.plugin.builders.structure.representation.applyPreset(structure, 'auto');
            this.previewStructureRef = structure.ref;
            return;
        }
        setSubtreeVisibility(this.plugin.state.data, this.previewStructureRef, false);
    }

    private async cleanupEditableStructure(restoreSource: boolean) {
        if (restoreSource && this.sourceStructureRef) {
            setSubtreeVisibility(this.plugin.state.data, this.sourceStructureRef, false);
        }
        if (this.previewStructureRef) {
            await this.plugin.build().delete(this.previewStructureRef).commit();
            this.previewStructureRef = void 0;
        }
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
        return DEFAULT_GIZMO_SCALE;
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
                xrayShaded: false,
                ignoreLight: false,
            });

        await update.commit();
        this.gizmoRef = update.selector.cell?.transform.parent;
    }

    private attachPointerEvents() {
        const canvas = this.plugin.canvas3dContext?.canvas;
        if (!canvas || this.pointerHost === canvas) return;
        canvas.addEventListener('pointerdown', this.onPointerDown, true);
        canvas.addEventListener('pointermove', this.onPointerMove, true);
        canvas.addEventListener('pointerup', this.onPointerUp, true);
        canvas.addEventListener('pointercancel', this.onPointerCancel, true);
        canvas.style.touchAction = 'none';
        this.pointerHost = canvas;
    }

    private detachPointerEvents() {
        if (!this.pointerHost) return;
        this.pointerHost.removeEventListener('pointerdown', this.onPointerDown, true);
        this.pointerHost.removeEventListener('pointermove', this.onPointerMove, true);
        this.pointerHost.removeEventListener('pointerup', this.onPointerUp, true);
        this.pointerHost.removeEventListener('pointercancel', this.onPointerCancel, true);
        this.pointerHost = void 0;
    }

    private getClientPointFromPointer(event: PointerEvent): Point2 {
        return [event.clientX, event.clientY];
    }

    private beginPointerDrag(handle: GizmoHandleId, pointerId: number, point: Point2) {
        const kind: EditKind = handle.startsWith('translate') ? 'move' : 'rotate';
        this.dragOperation = { handle, kind };
        this.dragPointerId = pointerId;
        this.dragLastPoint = point;
        this.setState(kind === 'move' ? 'dragging-translate' : 'dragging-rotate');
        void this.showGizmo();
    }

    private endPointerDrag(pointerId: number) {
        if (this.dragPointerId !== pointerId) return;
        this.dragOperation = void 0;
        this.dragPointerId = void 0;
        this.dragLastPoint = void 0;
        this.setState('armed-transform');
        void this.showGizmo();
    }

    private onPointerDown = (event: PointerEvent) => {
        if (!this.session) return;
        const projected = getProjectedGizmoPoints(this.plugin, this.session, this.getGizmoScale());
        const pointer = this.getClientPointFromPointer(event);
        const handle = pickGizmoHandleAtPoint(
            [projected.center[0], projected.center[1]],
            projected,
            pointer,
        );
        if (!handle) return;
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.disableInteractivity();
        this.beginPointerDrag(handle, event.pointerId, pointer);
    };

    private onPointerMove = (event: PointerEvent) => {
        if (!this.session || !this.dragOperation || this.dragPointerId !== event.pointerId || !this.plugin.canvas3d) return;
        const current = this.getClientPointFromPointer(event);
        const previous = this.dragLastPoint ?? current;
        if (this.dragOperation.kind === 'move') {
            const axis = getHandleAxis(this.dragOperation.handle);
            const distance = this.projectTranslationDistance(axis, toVec2(previous), toVec2(current));
            applyTranslationStep(this.session, axis, distance);
        } else {
            const axis = getHandleAxis(this.dragOperation.handle);
            const angle = this.projectRotationAngle(axis, toVec2(previous), toVec2(current));
            applyRotationStep(this.session, axis, angle);
        }
        this.dragLastPoint = current;
        this.scheduleFrame();
        event.preventDefault();
        event.stopPropagation();
    };

    private onPointerUp = (event: PointerEvent) => {
        if (this.dragPointerId !== event.pointerId) return;
        this.restoreInteractivity();
        this.endPointerDrag(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    };

    private onPointerCancel = (event: PointerEvent) => {
        if (this.dragPointerId !== event.pointerId) return;
        this.restoreInteractivity();
        this.endPointerDrag(event.pointerId);
    };

    private async applyQuickStyle(preset: 'default' | 'cartoon' | 'ball-and-stick' | 'spacefill' | 'surface') {
        const structures = this.plugin.managers.structure.hierarchy.current.structures;
        if (structures.length === 0) {
            showToast(this.plugin, 'Structure Editor', 'Load a structure before applying a style.');
            return;
        }

        const provider = preset === 'default'
            ? this.plugin.builders.structure.representation.resolveProvider(
                this.plugin.config.get(PluginConfig.Structure.DefaultRepresentationPreset) || PresetStructureRepresentations.auto.id,
            )
            : preset === 'cartoon'
                ? PresetStructureRepresentations['polymer-and-ligand']
                : preset === 'ball-and-stick'
                    ? PresetStructureRepresentations['atomic-detail']
                : preset === 'spacefill'
                    ? PresetStructureRepresentations.illustrative
                    : PresetStructureRepresentations['molecular-surface'];

        await this.plugin.managers.structure.component.applyPreset(structures, provider as any);
    }

    private async hideGizmo() {
        if (!this.gizmoRef) return;
        const ref = this.gizmoRef;
        this.gizmoRef = void 0;
        await this.plugin.build().delete(ref).commit();
    }

    private onClick(event: any) {
        const loci = event.current?.loci as StructureElement.Loci | undefined;
        if (loci?.kind === 'element-loci' && loci.elements.length > 0 && loci.structure?.model?.id) {
            this.lastPickedLoci = loci;
        }
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
        const scale = this.getGizmoScale();
        const p0 = toVec2(getCanvasClientPoint(this.plugin, anchor));
        const p1 = toVec2(getCanvasClientPoint(this.plugin, Vec3.scaleAndAdd(Vec3(), anchor, axis, scale)));
        const axisScreen = Vec2.sub(Vec2(), p1, p0);
        const delta = Vec2.sub(Vec2(), end, start);
        const axisScreenLength = Math.max(Vec2.magnitude(axisScreen), 1e-6);
        return scale * (delta[0] * axisScreen[0] + delta[1] * axisScreen[1]) / (axisScreenLength * axisScreenLength);
    }

    private projectRotationAngle(axis: Vec3, start: Vec2, end: Vec2) {
        const anchor = getCurrentAnchor(this.session!);
        const ring = sampleProjectedRingPoints(this.plugin, anchor, axis, this.getGizmoScale() * 0.9);
        const nearest = getClosestPolylineSegment([start[0], start[1]], ring);
        if (!nearest) return 0;

        const tangent = Vec2.sub(Vec2(), Vec2.create(nearest.end[0], nearest.end[1]), Vec2.create(nearest.start[0], nearest.start[1]));
        const tangentLength = Math.max(Vec2.magnitude(tangent), 1e-6);
        Vec2.scale(tangent, tangent, 1 / tangentLength);

        const delta = Vec2.sub(Vec2(), end, start);
        const segmentAngle = (Math.PI * 2) / ring.length;
        return (delta[0] * tangent[0] + delta[1] * tangent[1]) / tangentLength * segmentAngle;
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
        toolbar.style.zIndex = '20';

        const buttons = [
            ['Transform', () => this.enterTransformMode()],
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

        const styles = document.createElement('div');
        styles.style.display = 'flex';
        styles.style.gap = '6px';
        styles.style.marginLeft = '10px';

        const styleButtons = [
            ['Default', () => this.applyQuickStyle('default')],
            ['Cartoon', () => this.applyQuickStyle('cartoon')],
            ['Ball & Stick', () => this.applyQuickStyle('ball-and-stick')],
            ['Spacefill', () => this.applyQuickStyle('spacefill')],
            ['Surface', () => this.applyQuickStyle('surface')],
        ] as const;

        for (const [label, action] of styleButtons) {
            const button = document.createElement('button');
            button.textContent = label;
            button.style.border = 'none';
            button.style.padding = '6px 10px';
            button.style.borderRadius = '6px';
            button.style.cursor = 'pointer';
            button.addEventListener('click', () => void action());
            styles.appendChild(button);
        }
        toolbar.appendChild(styles);

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
        if (buttons[0]) (buttons[0] as HTMLButtonElement).disabled = hasSession && this.state.startsWith('dragging');
        if (buttons[1]) (buttons[1] as HTMLButtonElement).disabled = !hasSession;
        if (buttons[2]) (buttons[2] as HTMLButtonElement).disabled = !hasSession;
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
