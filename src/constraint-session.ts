import { Frame, Model } from 'molstar/lib/mol-model/structure';
import {
    applyAngleConstraint,
    applyDihedralConstraint,
    applyDistanceConstraint,
    measureAngle,
    measureDihedral,
    measureDistance,
    type MutableFrame,
} from './constraint-geometry';

export type ConstraintKind = 'distance' | 'angle' | 'dihedral';

export interface ConstraintEditSession {
    readonly kind: ConstraintKind
    readonly model: Model
    readonly atomIndices: [number, number] | [number, number, number] | [number, number, number, number]
    readonly initialFrame: MutableFrame
    readonly baseFrame: MutableFrame
    readonly currentFrame: MutableFrame
    movableAtomIndices: number[]
    anchorAtomIndices: number[]
    readonly allowedLockedAtomIndices: number[]
    lockedAtomIndex: number
    originalValue: number
    currentValue: number
    update: (targetValue: number) => void
    setLockedAtomIndex: (atomIndex: number) => void
}

type CreateConstraintEditSessionParams = {
    kind: ConstraintKind
    model: Model
    atomIndices: [number, number] | [number, number, number] | [number, number, number, number]
};

function cloneNumberArray(xs: ArrayLike<number>) {
    return ArrayBuffer.isView(xs)
        ? (xs as Float32Array | Float64Array).slice()
        : Array.from(xs);
}

function cloneFrame(model: Model): MutableFrame {
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

function copyFrame(into: Frame, from: Frame) {
    for (let i = 0; i < from.elementCount; i++) {
        (into.x as Float32Array | Float64Array)[i] = from.x[i];
        (into.y as Float32Array | Float64Array)[i] = from.y[i];
        (into.z as Float32Array | Float64Array)[i] = from.z[i];
    }
    into.time.value += 1;
}

function measure(kind: ConstraintKind, frame: MutableFrame, atomIndices: ConstraintEditSession['atomIndices']) {
    if (kind === 'distance') return measureDistance(frame, atomIndices as [number, number]);
    if (kind === 'angle') return measureAngle(frame, atomIndices as [number, number, number]);
    return measureDihedral(frame, atomIndices as [number, number, number, number]);
}

function apply(kind: ConstraintKind, frame: MutableFrame, atomIndices: ConstraintEditSession['atomIndices'], movableAtomIndices: readonly number[], value: number) {
    if (kind === 'distance') {
        applyDistanceConstraint(frame, atomIndices as [number, number], movableAtomIndices, value);
        return;
    }
    if (kind === 'angle') {
        applyAngleConstraint(frame, atomIndices as [number, number, number], movableAtomIndices, value);
        return;
    }
    applyDihedralConstraint(frame, atomIndices as [number, number, number, number], movableAtomIndices, value);
}

function getAllowedLockedAtomIndices(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices']) {
    if (kind === 'distance') return [atomIndices[0] as number, atomIndices[1] as number];
    if (kind === 'angle') return [atomIndices[0] as number, atomIndices[2] as number];
    return [atomIndices[0] as number, atomIndices[3] as number];
}

function getResolvedConstraint(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], lockedAtomIndex: number) {
    if (kind === 'distance') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number],
                anchorAtomIndices: [atomIndices[0] as number],
                movableAtomIndices: [atomIndices[1] as number],
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[1] as number, atomIndices[0] as number] as [number, number],
            anchorAtomIndices: [atomIndices[1] as number],
            movableAtomIndices: [atomIndices[0] as number],
        };
    }

    if (kind === 'angle') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number, number],
                anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number],
                movableAtomIndices: [atomIndices[2] as number],
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number],
            anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number],
            movableAtomIndices: [atomIndices[0] as number],
        };
    }

    if (lockedAtomIndex === atomIndices[0]) {
        return {
            resolvedAtomIndices: atomIndices as [number, number, number, number],
            anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number, atomIndices[2] as number],
            movableAtomIndices: [atomIndices[3] as number],
        };
    }
    return {
        resolvedAtomIndices: [atomIndices[3] as number, atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number, number],
        anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number, atomIndices[3] as number],
        movableAtomIndices: [atomIndices[0] as number],
    };
}

export function createConstraintEditSession({ kind, model, atomIndices }: CreateConstraintEditSessionParams): ConstraintEditSession {
    const initialFrame = cloneFrame(model);
    const baseFrame = cloneFrame(model);
    const currentFrame = cloneFrame(model);
    const allowedLockedAtomIndices = getAllowedLockedAtomIndices(kind, atomIndices);
    const defaultLockedAtomIndex = allowedLockedAtomIndices[0];
    const resolved = getResolvedConstraint(kind, atomIndices, defaultLockedAtomIndex);
    const originalValue = measure(kind, currentFrame, atomIndices);

    const session: ConstraintEditSession = {
        kind,
        model,
        atomIndices,
        initialFrame,
        baseFrame,
        currentFrame,
        movableAtomIndices: resolved.movableAtomIndices,
        anchorAtomIndices: resolved.anchorAtomIndices,
        allowedLockedAtomIndices,
        lockedAtomIndex: defaultLockedAtomIndex,
        originalValue,
        currentValue: originalValue,
        update(targetValue: number) {
            copyFrame(currentFrame, baseFrame);
            const next = getResolvedConstraint(kind, atomIndices, session.lockedAtomIndex);
            session.anchorAtomIndices = next.anchorAtomIndices;
            session.movableAtomIndices = next.movableAtomIndices;
            apply(kind, currentFrame, next.resolvedAtomIndices as any, session.movableAtomIndices, targetValue);
            session.currentValue = measure(kind, currentFrame, atomIndices);
        },
        setLockedAtomIndex(atomIndex: number) {
            if (!session.allowedLockedAtomIndices.includes(atomIndex)) {
                throw new Error('This atom cannot be locked for the selected constraint.');
            }
            session.lockedAtomIndex = atomIndex;
            const next = getResolvedConstraint(kind, atomIndices, atomIndex);
            session.anchorAtomIndices = next.anchorAtomIndices;
            session.movableAtomIndices = next.movableAtomIndices;
            copyFrame(currentFrame, baseFrame);
            apply(kind, currentFrame, next.resolvedAtomIndices as any, session.movableAtomIndices, session.currentValue);
            session.currentValue = measure(kind, currentFrame, atomIndices);
        },
    };

    return session;
}

export function cancelConstraintSession(session: ConstraintEditSession) {
    copyFrame(session.currentFrame, session.baseFrame);
    session.currentValue = measure(session.kind, session.currentFrame, session.atomIndices);
}

export function commitConstraintSession(session: ConstraintEditSession) {
    copyFrame(session.baseFrame, session.currentFrame);
    session.originalValue = measure(session.kind, session.baseFrame, session.atomIndices);
    session.currentValue = session.originalValue;
}
