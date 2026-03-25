import { OrderedSet } from 'molstar/lib/mol-data/int';
import { Frame, Model, Structure, StructureElement, Unit } from 'molstar/lib/mol-model/structure';
import { Mat3, Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';

export type EditKind = 'move' | 'rotate';
export type EditState = 'idle' | 'armed-move' | 'armed-rotate' | 'dragging-translate' | 'dragging-rotate' | 'committing' | 'cancelled';
export type GizmoHandle = 'translate-x' | 'translate-y' | 'translate-z' | 'rotate-x' | 'rotate-y' | 'rotate-z';

export interface EditSession {
    readonly model: Model
    readonly structure: Structure
    readonly selection: StructureElement.Loci
    readonly atomIndices: number[]
    readonly centroid: Vec3
    readonly currentCentroid: Vec3
    readonly translation: Vec3
    readonly rotation: Mat3
    readonly currentFrame: Frame
    readonly baseFrame: Frame
    readonly initialFrame: Frame
    readonly maxRealtimeAtoms: number
}

export interface CreateEditSessionParams {
    model: Model
    structure: Structure
    selection: StructureElement.Loci
    maxRealtimeAtoms: number
}

function cloneNumberArray(xs: ArrayLike<number>) {
    return ArrayBuffer.isView(xs)
        ? (xs as Float32Array | Float64Array).slice()
        : Array.from(xs);
}

function cloneFrame(model: Model): Frame {
    const { x, y, z } = model.atomicConformation;
    return {
        elementCount: x.length,
        time: { value: 0, unit: 'step' },
        xyzOrdering: { isIdentity: true },
        x: cloneNumberArray(x),
        y: cloneNumberArray(y),
        z: cloneNumberArray(z),
    };
}

function ensureAtomicIdentitySelection(selection: StructureElement.Loci, model: Model) {
    const atomIndices = new Set<number>();

    for (const element of selection.elements) {
        if (!Unit.isAtomic(element.unit)) {
            throw new Error('Only atomic selections can be edited.');
        }
        if (element.unit.model !== model) {
            throw new Error('Selections spanning multiple models are not supported.');
        }
        if (!Mat4.isIdentity(element.unit.conformation.operator.matrix)) {
            throw new Error('Selections on transformed assembly copies are not supported in v1.');
        }
        OrderedSet.forEach(element.indices, idx => atomIndices.add(element.unit.elements[idx]));
    }

    if (atomIndices.size === 0) {
        throw new Error('No atoms selected.');
    }
    return Array.from(atomIndices).sort((a, b) => a - b);
}

function computeCentroid(model: Model, atomIndices: readonly number[]) {
    const centroid = Vec3.zero();
    const { x, y, z } = model.atomicConformation;
    for (const atomIndex of atomIndices) {
        centroid[0] += x[atomIndex];
        centroid[1] += y[atomIndex];
        centroid[2] += z[atomIndex];
    }
    Vec3.scale(centroid, centroid, 1 / atomIndices.length);
    return centroid;
}

function rebuildCurrentFrame(session: EditSession) {
    const { atomIndices, centroid, currentCentroid, translation, rotation, currentFrame, baseFrame } = session;
    Vec3.add(currentCentroid, centroid, translation);

    const input = Vec3.zero();
    const rotated = Vec3.zero();
    for (const atomIndex of atomIndices) {
        input[0] = baseFrame.x[atomIndex] - centroid[0];
        input[1] = baseFrame.y[atomIndex] - centroid[1];
        input[2] = baseFrame.z[atomIndex] - centroid[2];
        Vec3.transformMat3(rotated, input, rotation);

        (currentFrame.x as any)[atomIndex] = currentCentroid[0] + rotated[0];
        (currentFrame.y as any)[atomIndex] = currentCentroid[1] + rotated[1];
        (currentFrame.z as any)[atomIndex] = currentCentroid[2] + rotated[2];
    }
    currentFrame.time.value += 1;
}

export function createEditSession({ model, structure, selection, maxRealtimeAtoms }: CreateEditSessionParams): EditSession {
    const atomIndices = ensureAtomicIdentitySelection(selection, model);
    const centroid = computeCentroid(model, atomIndices);
    const initialFrame = cloneFrame(model);
    const baseFrame = cloneFrame(model);
    const currentFrame = cloneFrame(model);

    return {
        model,
        structure,
        selection,
        atomIndices,
        centroid,
        currentCentroid: Vec3.clone(centroid),
        translation: Vec3.zero(),
        rotation: Mat3.identity(),
        currentFrame,
        baseFrame,
        initialFrame,
        maxRealtimeAtoms,
    };
}

export function applyTranslationStep(session: EditSession, axis: Vec3, distance: number) {
    Vec3.scaleAndAdd(session.translation, session.translation, axis, distance);
    rebuildCurrentFrame(session);
}

export function applyRotationStep(session: EditSession, axis: Vec3, angle: number) {
    const rotationStep = Mat3.fromMat4(Mat3(), Mat4.fromRotation(Mat4(), angle, axis));
    Mat3.mul(session.rotation, rotationStep, session.rotation);
    rebuildCurrentFrame(session);
}

function copyFrame(into: Frame, from: Frame) {
    for (let i = 0, il = from.elementCount; i < il; i++) {
        (into.x as any)[i] = from.x[i];
        (into.y as any)[i] = from.y[i];
        (into.z as any)[i] = from.z[i];
    }
    into.time.value += 1;
}

export function cancelSession(session: EditSession) {
    copyFrame(session.currentFrame, session.baseFrame);
    session.translation[0] = 0;
    session.translation[1] = 0;
    session.translation[2] = 0;
    Mat3.setIdentity(session.rotation);
    Vec3.copy(session.currentCentroid, session.centroid);
}

export function commitSession(session: EditSession) {
    copyFrame(session.baseFrame, session.currentFrame);
    Vec3.copy(session.centroid, session.currentCentroid);
    session.translation[0] = 0;
    session.translation[1] = 0;
    session.translation[2] = 0;
    Mat3.setIdentity(session.rotation);
}
