import { Frame, Model, Structure, Unit } from 'molstar/lib/mol-model/structure';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra';
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
export type ConstraintMoveScope = 'fragment' | 'atom';

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
    originalValue: number
    currentValue: number
    update: (targetValue: number) => void
    setLockedAtomIndex: (atomIndex: number) => void
    setMoveScope: (scope: ConstraintMoveScope) => void
    isMoveScopeAvailable: (scope: ConstraintMoveScope) => boolean
}

type CreateConstraintEditSessionParams = {
    kind: ConstraintKind
    model: Model
    structure: Structure
    atomIndices: [number, number] | [number, number, number] | [number, number, number, number]
    moveScope?: ConstraintMoveScope
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

type ConstraintResolution = {
    resolvedAtomIndices: ConstraintEditSession['atomIndices']
    anchorAtomIndices: number[]
    cutBond: [number, number]
    movableSeedAtomIndex: number
};

function getResolvedConstraint(kind: ConstraintKind, atomIndices: ConstraintEditSession['atomIndices'], lockedAtomIndex: number): ConstraintResolution {
    if (kind === 'distance') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number],
                anchorAtomIndices: [atomIndices[0] as number],
                cutBond: [atomIndices[0] as number, atomIndices[1] as number],
                movableSeedAtomIndex: atomIndices[1] as number,
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[1] as number, atomIndices[0] as number] as [number, number],
            anchorAtomIndices: [atomIndices[1] as number],
            cutBond: [atomIndices[0] as number, atomIndices[1] as number],
            movableSeedAtomIndex: atomIndices[0] as number,
        };
    }

    if (kind === 'angle') {
        if (lockedAtomIndex === atomIndices[0]) {
            return {
                resolvedAtomIndices: atomIndices as [number, number, number],
                anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number],
                cutBond: [atomIndices[1] as number, atomIndices[2] as number],
                movableSeedAtomIndex: atomIndices[2] as number,
            };
        }
        return {
            resolvedAtomIndices: [atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number],
            anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number],
            cutBond: [atomIndices[0] as number, atomIndices[1] as number],
            movableSeedAtomIndex: atomIndices[0] as number,
        };
    }

    if (lockedAtomIndex === atomIndices[0]) {
        return {
            resolvedAtomIndices: atomIndices as [number, number, number, number],
            anchorAtomIndices: [atomIndices[0] as number, atomIndices[1] as number, atomIndices[2] as number],
            cutBond: [atomIndices[1] as number, atomIndices[2] as number],
            movableSeedAtomIndex: atomIndices[2] as number,
        };
    }
    return {
        resolvedAtomIndices: [atomIndices[3] as number, atomIndices[2] as number, atomIndices[1] as number, atomIndices[0] as number] as [number, number, number, number],
        anchorAtomIndices: [atomIndices[1] as number, atomIndices[2] as number, atomIndices[3] as number],
        cutBond: [atomIndices[1] as number, atomIndices[2] as number],
        movableSeedAtomIndex: atomIndices[1] as number,
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

    const movableAtoms = collectComponentAtoms(adjacency, resolved.movableSeedAtomIndex, resolved.cutBond);
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
            movableAtomIndices: [resolved.movableSeedAtomIndex],
        };
    }
    return resolveMovableFragmentAtoms(adjacency, kind, atomIndices, lockedAtomIndex);
}

export function createConstraintEditSession({ kind, model, structure, atomIndices, moveScope = 'fragment' }: CreateConstraintEditSessionParams): ConstraintEditSession {
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
        originalValue,
        currentValue: originalValue,
        update(targetValue: number) {
            copyFrame(currentFrame, baseFrame);
            const next = resolveMovableAtoms(adjacency, kind, atomIndices, session.lockedAtomIndex, session.moveScope);
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
            if (session.moveScope === 'fragment' && !isFragmentScopeAvailable(adjacency, kind, atomIndices, atomIndex)) {
                session.moveScope = 'atom';
            }
            const next = resolveMovableAtoms(adjacency, kind, atomIndices, atomIndex, session.moveScope);
            session.anchorAtomIndices = next.anchorAtomIndices;
            session.movableAtomIndices = next.movableAtomIndices;
            copyFrame(currentFrame, baseFrame);
            apply(kind, currentFrame, next.resolvedAtomIndices as any, session.movableAtomIndices, session.currentValue);
            session.currentValue = measure(kind, currentFrame, atomIndices);
        },
        setMoveScope(scope: ConstraintMoveScope) {
            if (scope !== 'atom' && scope !== 'fragment') {
                throw new Error('Unsupported move scope.');
            }
            if (scope === 'fragment' && !isFragmentScopeAvailable(adjacency, kind, atomIndices, session.lockedAtomIndex)) {
                throw new Error('Fragment scope is not available for the selected atoms and lock side.');
            }
            session.moveScope = scope;
            const next = resolveMovableAtoms(adjacency, kind, atomIndices, session.lockedAtomIndex, scope);
            session.anchorAtomIndices = next.anchorAtomIndices;
            session.movableAtomIndices = next.movableAtomIndices;
            copyFrame(currentFrame, baseFrame);
            apply(kind, currentFrame, next.resolvedAtomIndices as any, session.movableAtomIndices, session.currentValue);
            session.currentValue = measure(kind, currentFrame, atomIndices);
        },
        isMoveScopeAvailable(scope: ConstraintMoveScope) {
            if (scope === 'atom') return true;
            return isFragmentScopeAvailable(adjacency, kind, atomIndices, session.lockedAtomIndex);
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
