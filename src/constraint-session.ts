import { Frame, Model, Structure, Unit } from 'molstar/lib/mol-model/structure';
import { Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import {
    applyAngleConstraint,
    applyDihedralConstraint,
    applyDistanceConstraint,
    getFlexibleWeight,
    measureAngle,
    measureDihedral,
    measureDistance,
    type MutableFrame,
} from './constraint-geometry';

export type ConstraintKind = 'distance' | 'angle' | 'dihedral';
export type ConstraintMoveScope = 'fragment' | 'atom';
export type ConstraintType = 'rigid' | 'flexible';

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
    moveScope: ConstraintMoveScope
    constraintType: ConstraintType
    flexMaxBondDepth: number
    flexStrength: number
    originalValue: number
    currentValue: number
    update: (targetValue: number) => void
    setLockedAtomIndex: (atomIndex: number) => void
    setMoveScope: (scope: ConstraintMoveScope) => void
    isMoveScopeAvailable: (scope: ConstraintMoveScope) => boolean
    setConstraintType: (type: ConstraintType) => void
    setFlexParams: (params: { maxBondDepth?: number; strength?: number }) => void
}

type CreateConstraintEditSessionParams = {
    kind: ConstraintKind
    model: Model
    structure: Structure
    atomIndices: [number, number] | [number, number, number] | [number, number, number, number]
    moveScope?: ConstraintMoveScope
    constraintType?: ConstraintType
    flexMaxBondDepth?: number
    flexStrength?: number
};

type ConstraintResolution = {
    resolvedAtomIndices: ConstraintEditSession['atomIndices']
    anchorAtomIndices: number[]
    cutBond: [number, number]
    movableFragmentSeedAtomIndex: number
    movableAtomIndex: number
};

type ConstraintTransform =
    | { kind: 'translation'; delta: Vec3 }
    | { kind: 'rotation'; origin: Vec3; axis: Vec3; angleInRadians: number };

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

function getAllowedLockedAtomIndices(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices']) {
    if (kind === 'distance') return [atomIndices[0] as number, atomIndices[1] as number];
    if (kind === 'angle') return [atomIndices[0] as number, atomIndices[2] as number];
    return [atomIndices[0] as number, atomIndices[3] as number];
}

function getResolvedConstraint(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], lockedAtomIndex: number): ConstraintResolution {
    if (kind === 'distance') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number],
                anchorAtomIndices: [atomIndices[0] as number],
                cutBond: [atomIndices[0] as number, atomIndices[1] as number],
                movableFragmentSeedAtomIndex: atomIndices[1] as number,
                movableAtomIndex: atomIndices[1] as number,
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[1] as number, atomIndices[0] as number] as [number, number],
            anchorAtomIndices: [atomIndices[1] as number],
            cutBond: [atomIndices[0] as number, atomIndices[1] as number],
            movableFragmentSeedAtomIndex: atomIndices[0] as number,
            movableAtomIndex: atomIndices[0] as number,
        };
    }

    if (kind === 'angle') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number, number],
                anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number],
                cutBond: [atomIndices[1] as number, atomIndices[2] as number],
                movableFragmentSeedAtomIndex: atomIndices[2] as number,
                movableAtomIndex: atomIndices[2] as number,
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number],
            anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number],
            cutBond: [atomIndices[0] as number, atomIndices[1] as number],
            movableFragmentSeedAtomIndex: atomIndices[0] as number,
            movableAtomIndex: atomIndices[0] as number,
        };
    }

    if (lockedAtomIndex === atomIndices[0]) {
        return {
            resolvedAtomIndices: atomIndices as [number, number, number, number],
            anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number, atomIndices[2] as number],
            cutBond: [atomIndices[1] as number, atomIndices[2] as number],
            movableFragmentSeedAtomIndex: atomIndices[2] as number,
            movableAtomIndex: atomIndices[3] as number,
        };
    }
    return {
        resolvedAtomIndices: [atomIndices[3] as number, atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number, number],
        anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number, atomIndices[3] as number],
        cutBond: [atomIndices[1] as number, atomIndices[2] as number],
        movableFragmentSeedAtomIndex: atomIndices[1] as number,
        movableAtomIndex: atomIndices[0] as number,
    };
}

function ensureExpectedConstraintBonds(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], hasBond: (a: number, b: number) => boolean) {
    if (kind === 'distance') {
        if (!hasBond(atomIndices[0] as number, atomIndices[1] as number)) {
            throw new Error('The selected distance atoms are not connected by a bond.');
        }
        return;
    }
    if (kind === 'angle') {
        if (!hasBond(atomIndices[0] as number, atomIndices[1] as number) || !hasBond(atomIndices[1] as number, atomIndices[2] as number)) {
            throw new Error('The selected angle atoms must form a bonded path A-B-C.');
        }
        return;
    }
    if (!hasBond(atomIndices[0] as number, atomIndices[1] as number)
        || !hasBond(atomIndices[1] as number, atomIndices[2] as number)
        || !hasBond(atomIndices[2] as number, atomIndices[3] as number)) {
        throw new Error('The selected dihedral atoms must form a bonded path A-B-C-D.');
    }
}

function addUndirectedEdge(adjacency: Map<number, Set<number>>, a: number, b: number) {
    if (!adjacency.has(a)) adjacency.set(a, new Set<number>());
    if (!adjacency.has(b)) adjacency.set(b, new Set<number>());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
}

function buildAtomAdjacency(structure: Structure, selectedAtomIndices: readonly number[]) {
    const selected = new Set(selectedAtomIndices);
    const adjacency = new Map<number, Set<number>>();
    const atomicUnits = structure.units.filter((unit): unit is Unit.Atomic => Unit.isAtomic(unit));
    const unitById = new Map<number, Unit.Atomic>();

    for (const unit of atomicUnits) {
        unitById.set(unit.id, unit);
        let hasSelectedInUnit = false;
        for (let i = 0; i < unit.elements.length; i++) {
            const atomIndex = unit.elements[i];
            if (!adjacency.has(atomIndex)) adjacency.set(atomIndex, new Set<number>());
            if (!hasSelectedInUnit && selected.has(atomIndex)) hasSelectedInUnit = true;
        }
        if (hasSelectedInUnit && !Mat4.isIdentity(unit.conformation.operator.matrix)) {
            throw new Error('Selections on transformed assembly copies are not supported in v1.');
        }
        const bonds = unit.bonds;
        for (let localA = 0; localA < unit.elements.length; localA++) {
            const atomA = unit.elements[localA];
            for (let edge = bonds.offset[localA]; edge < bonds.offset[localA + 1]; edge++) {
                const localB = bonds.b[edge];
                const atomB = unit.elements[localB];
                addUndirectedEdge(adjacency, atomA, atomB);
            }
        }
    }

    for (const edge of structure.interUnitBonds.edges) {
        const unitA = unitById.get(edge.unitA);
        const unitB = unitById.get(edge.unitB);
        if (!unitA || !unitB) continue;
        const atomA = unitA.elements[edge.indexA];
        const atomB = unitB.elements[edge.indexB];
        addUndirectedEdge(adjacency, atomA, atomB);
    }

    return adjacency;
}

function collectComponentAtoms(adjacency: Map<number, Set<number>>, startAtomIndex: number, cutBond: [number, number]) {
    const [cutA, cutB] = cutBond;
    const result: number[] = [];
    const queue = [startAtomIndex];
    const visited = new Set<number>();

    while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        result.push(current);
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        for (const next of neighbors) {
            const isCutEdge = (current === cutA && next === cutB) || (current === cutB && next === cutA);
            if (isCutEdge || visited.has(next)) continue;
            queue.push(next);
        }
    }

    return result.sort((a, b) => a - b);
}

function resolveMovableFragmentAtoms(adjacency: Map<number, Set<number>>, kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], lockedAtomIndex: number) {
    const resolved = getResolvedConstraint(kind, atomIndices, lockedAtomIndex);
    const [cutA, cutB] = resolved.cutBond;
    const hasBond = adjacency.get(cutA)?.has(cutB) ?? false;
    if (!hasBond) {
        throw new Error('The selected atoms do not define a valid center bond for this constraint.');
    }

    const movableAtoms = collectComponentAtoms(adjacency, resolved.movableFragmentSeedAtomIndex, resolved.cutBond);
    if (movableAtoms.includes(cutA) && movableAtoms.includes(cutB)) {
        throw new Error('The selected bond does not split the molecular graph into movable fragments.');
    }
    if (!movableAtoms.length) {
        throw new Error('No movable fragment was found for the selected lock side.');
    }

    return {
        resolvedAtomIndices: resolved.resolvedAtomIndices,
        anchorAtomIndices: resolved.anchorAtomIndices,
        movableAtomIndices: movableAtoms,
    };
}

function isFragmentScopeAvailable(adjacency: Map<number, Set<number>>, kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], lockedAtomIndex: number) {
    try {
        resolveMovableFragmentAtoms(adjacency, kind, atomIndices, lockedAtomIndex);
        return true;
    } catch {
        return false;
    }
}

function resolveMovableAtoms(
    adjacency: Map<number, Set<number>>,
    kind: ConstraintKind,
    atomIndices: ConstraintEditSession['atomIndices'],
    lockedAtomIndex: number,
    moveScope: ConstraintMoveScope,
) {
    const resolved = getResolvedConstraint(kind, atomIndices, lockedAtomIndex);
    if (moveScope === 'atom') {
        return {
            resolvedAtomIndices: resolved.resolvedAtomIndices,
            anchorAtomIndices: resolved.anchorAtomIndices,
            movableAtomIndices: [resolved.movableAtomIndex],
        };
    }
    return resolveMovableFragmentAtoms(adjacency, kind, atomIndices, lockedAtomIndex);
}

function measure(kind: ConstraintKind, frame: MutableFrame, atomIndices: ConstraintEditSession['atomIndices']) {
    if (kind === 'distance') return measureDistance(frame, atomIndices as [number, number]);
    if (kind === 'angle') return measureAngle(frame, atomIndices as [number, number, number]);
    return measureDihedral(frame, atomIndices as [number, number, number, number]);
}

function applyRigidConstraint(kind: ConstraintKind, frame: MutableFrame, atomIndices: ConstraintEditSession['atomIndices'], movableAtomIndices: readonly number[], value: number) {
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

function getPoint(frame: MutableFrame, atomIndex: number) {
    return Vec3.create(frame.x[atomIndex], frame.y[atomIndex], frame.z[atomIndex]);
}

function setPoint(frame: MutableFrame, atomIndex: number, point: Vec3) {
    (frame.x as Float32Array | Float64Array)[atomIndex] = point[0];
    (frame.y as Float32Array | Float64Array)[atomIndex] = point[1];
    (frame.z as Float32Array | Float64Array)[atomIndex] = point[2];
}

function degreesToRadians(degrees: number) {
    return degrees * Math.PI / 180;
}

function wrapDegrees(value: number) {
    let next = value;
    while (next > 180) next -= 360;
    while (next <= -180) next += 360;
    return next;
}

function getConstraintTransform(kind: ConstraintKind, frame: MutableFrame, atomIndices: ConstraintEditSession['atomIndices'], targetValue: number): ConstraintTransform {
    if (kind === 'distance') {
        const [a, b] = atomIndices as [number, number];
        const anchor = getPoint(frame, a);
        const movable = getPoint(frame, b);
        const direction = Vec3.sub(Vec3(), movable, anchor);
        const length = Vec3.magnitude(direction);
        if (length < 1e-6) throw new Error('Cannot edit distance for coincident atoms.');
        Vec3.scale(direction, direction, 1 / length);
        const targetPoint = Vec3.scaleAndAdd(Vec3(), anchor, direction, targetValue);
        return { kind: 'translation', delta: Vec3.sub(Vec3(), targetPoint, movable) };
    }

    if (kind === 'angle') {
        const [a, b, c] = atomIndices as [number, number, number];
        const pointA = getPoint(frame, a);
        const pointB = getPoint(frame, b);
        const pointC = getPoint(frame, c);
        const ba = Vec3.sub(Vec3(), pointA, pointB);
        const bc = Vec3.sub(Vec3(), pointC, pointB);
        const normal = Vec3.cross(Vec3(), ba, bc);
        const normalLength = Vec3.magnitude(normal);
        if (Vec3.magnitude(ba) < 1e-6 || Vec3.magnitude(bc) < 1e-6 || normalLength < 1e-6) {
            throw new Error('Cannot edit angle for degenerate atoms.');
        }
        Vec3.scale(normal, normal, 1 / normalLength);
        const current = measureAngle(frame, [a, b, c]);
        return { kind: 'rotation', origin: pointB, axis: normal, angleInRadians: degreesToRadians(targetValue - current) };
    }

    const [a, b, c, d] = atomIndices as [number, number, number, number];
    void a;
    void d;
    const pointB = getPoint(frame, b);
    const pointC = getPoint(frame, c);
    const axis = Vec3.sub(Vec3(), pointC, pointB);
    const axisLength = Vec3.magnitude(axis);
    if (axisLength < 1e-6) {
        throw new Error('Cannot edit dihedral with coincident middle atoms.');
    }
    Vec3.scale(axis, axis, 1 / axisLength);
    const current = measureDihedral(frame, [a, b, c, d]);
    return { kind: 'rotation', origin: pointC, axis, angleInRadians: degreesToRadians(wrapDegrees(targetValue - current)) };
}

function applyTransformToAtoms(baseFrame: MutableFrame, currentFrame: MutableFrame, atomIndices: readonly number[], transform: ConstraintTransform, weight: number) {
    if (weight === 0) return;
    if (transform.kind === 'translation') {
        for (const atomIndex of atomIndices) {
            const point = getPoint(baseFrame, atomIndex);
            Vec3.scaleAndAdd(point, point, transform.delta, weight);
            setPoint(currentFrame, atomIndex, point);
        }
        return;
    }

    const rotation = Mat4.fromRotation(Mat4(), transform.angleInRadians * weight, transform.axis);
    const relative = Vec3.zero();
    const rotated = Vec3.zero();
    for (const atomIndex of atomIndices) {
        Vec3.sub(relative, getPoint(baseFrame, atomIndex), transform.origin);
        Vec3.transformMat4(rotated, relative, rotation);
        Vec3.add(rotated, rotated, transform.origin);
        setPoint(currentFrame, atomIndex, rotated);
    }
}

function collectFlexibleDepthMap(
    adjacency: Map<number, Set<number>>,
    seedAtomIndices: readonly number[],
    maxDepth: number,
    blockedAtomIndices: ReadonlySet<number>,
) {
    const depthMap = new Map<number, number>();
    const queue: Array<[number, number]> = [];
    for (const seedAtomIndex of seedAtomIndices) {
        if (depthMap.has(seedAtomIndex)) continue;
        depthMap.set(seedAtomIndex, 0);
        queue.push([seedAtomIndex, 0]);
    }
    while (queue.length) {
        const [current, depth] = queue.shift()!;
        if (depth >= maxDepth) continue;
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        for (const next of neighbors) {
            if (depthMap.has(next) || blockedAtomIndices.has(next)) continue;
            const nextDepth = depth + 1;
            depthMap.set(next, nextDepth);
            queue.push([next, nextDepth]);
        }
    }
    return depthMap;
}

function applyFlexibleConstraint(
    baseFrame: MutableFrame,
    currentFrame: MutableFrame,
    adjacency: Map<number, Set<number>>,
    kind: ConstraintKind,
    resolvedAtomIndices: ConstraintEditSession['atomIndices'],
    seedAtomIndices: readonly number[],
    anchorAtomIndices: readonly number[],
    targetValue: number,
    maxBondDepth: number,
    strength: number,
) {
    const transform = getConstraintTransform(kind, baseFrame, resolvedAtomIndices, targetValue);
    const uniqueSeeds = Array.from(new Set(seedAtomIndices));
    applyTransformToAtoms(baseFrame, currentFrame, uniqueSeeds, transform, 1);

    if (maxBondDepth < 1 || strength <= 0) {
        currentFrame.time.value += 1;
        return;
    }

    const seedSet = new Set(uniqueSeeds);
    const blocked = new Set(anchorAtomIndices);
    const depthMap = collectFlexibleDepthMap(adjacency, uniqueSeeds, maxBondDepth, blocked);
    for (const [atomIndex, depth] of depthMap) {
        if (depth === 0 || seedSet.has(atomIndex)) continue;
        const weight = getFlexibleWeight(depth, strength);
        applyTransformToAtoms(baseFrame, currentFrame, [atomIndex], transform, weight);
    }
    currentFrame.time.value += 1;
}

function clampFlexStrength(value: number) {
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
}

function clampFlexMaxBondDepth(value: number) {
    if (!Number.isFinite(value)) return 2;
    return Math.max(0, Math.min(6, Math.round(value)));
}

function normalizeConstraintType(type: ConstraintType | undefined): ConstraintType {
    return type === 'flexible' ? 'flexible' : 'rigid';
}

function applyConstraintForSession(
    session: ConstraintEditSession,
    adjacency: Map<number, Set<number>>,
    kind: ConstraintKind,
    atomIndices: ConstraintEditSession['atomIndices'],
    targetValue: number,
) {
    copyFrame(session.currentFrame, session.baseFrame);
    const next = resolveMovableAtoms(adjacency, kind, atomIndices, session.lockedAtomIndex, session.moveScope);
    session.anchorAtomIndices = next.anchorAtomIndices;
    session.movableAtomIndices = next.movableAtomIndices;

    if (session.constraintType === 'rigid') {
        applyRigidConstraint(kind, session.currentFrame, next.resolvedAtomIndices as any, session.movableAtomIndices, targetValue);
    } else {
        applyFlexibleConstraint(
            session.baseFrame,
            session.currentFrame,
            adjacency,
            kind,
            next.resolvedAtomIndices,
            session.movableAtomIndices,
            session.anchorAtomIndices,
            targetValue,
            session.flexMaxBondDepth,
            session.flexStrength,
        );
    }
    session.currentValue = measure(kind, session.currentFrame, atomIndices);
}

export function createConstraintEditSession({
    kind,
    model,
    structure,
    atomIndices,
    moveScope = 'fragment',
    constraintType,
    flexMaxBondDepth,
    flexStrength,
}: CreateConstraintEditSessionParams): ConstraintEditSession {
    if (structure.model !== model) {
        throw new Error('Constraint editing currently supports a single model structure only.');
    }

    const adjacency = buildAtomAdjacency(structure, atomIndices as number[]);
    ensureExpectedConstraintBonds(kind, atomIndices, (a, b) => adjacency.get(a)?.has(b) ?? false);

    const initialFrame = cloneFrame(model);
    const baseFrame = cloneFrame(model);
    const currentFrame = cloneFrame(model);
    const allowedLockedAtomIndices = getAllowedLockedAtomIndices(kind, atomIndices);
    const defaultLockedAtomIndex = allowedLockedAtomIndices[0];
    const defaultScope = moveScope === 'fragment' && !isFragmentScopeAvailable(adjacency, kind, atomIndices, defaultLockedAtomIndex)
        ? 'atom'
        : moveScope;
    const resolved = resolveMovableAtoms(adjacency, kind, atomIndices, defaultLockedAtomIndex, defaultScope);
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
        moveScope: defaultScope,
        constraintType: normalizeConstraintType(constraintType),
        flexMaxBondDepth: clampFlexMaxBondDepth(flexMaxBondDepth ?? 2),
        flexStrength: clampFlexStrength(flexStrength ?? 0.5),
        originalValue,
        currentValue: originalValue,
        update(targetValue: number) {
            applyConstraintForSession(session, adjacency, kind, atomIndices, targetValue);
        },
        setLockedAtomIndex(atomIndex: number) {
            if (!session.allowedLockedAtomIndices.includes(atomIndex)) {
                throw new Error('This atom cannot be locked for the selected constraint.');
            }
            session.lockedAtomIndex = atomIndex;
            if (session.moveScope === 'fragment' && !isFragmentScopeAvailable(adjacency, kind, atomIndices, atomIndex)) {
                session.moveScope = 'atom';
            }
            applyConstraintForSession(session, adjacency, kind, atomIndices, session.currentValue);
        },
        setMoveScope(scope: ConstraintMoveScope) {
            if (scope !== 'atom' && scope !== 'fragment') {
                throw new Error('Unsupported move scope.');
            }
            if (scope === 'fragment' && !isFragmentScopeAvailable(adjacency, kind, atomIndices, session.lockedAtomIndex)) {
                throw new Error('Fragment scope is not available for the selected atoms and lock side.');
            }
            session.moveScope = scope;
            applyConstraintForSession(session, adjacency, kind, atomIndices, session.currentValue);
        },
        isMoveScopeAvailable(scope: ConstraintMoveScope) {
            if (scope === 'atom') return true;
            return isFragmentScopeAvailable(adjacency, kind, atomIndices, session.lockedAtomIndex);
        },
        setConstraintType(type: ConstraintType) {
            session.constraintType = normalizeConstraintType(type);
            applyConstraintForSession(session, adjacency, kind, atomIndices, session.currentValue);
        },
        setFlexParams(params: { maxBondDepth?: number; strength?: number }) {
            if (params.maxBondDepth !== undefined) {
                session.flexMaxBondDepth = clampFlexMaxBondDepth(params.maxBondDepth);
            }
            if (params.strength !== undefined) {
                session.flexStrength = clampFlexStrength(params.strength);
            }
            applyConstraintForSession(session, adjacency, kind, atomIndices, session.currentValue);
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
