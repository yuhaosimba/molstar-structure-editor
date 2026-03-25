import { Frame } from 'molstar/lib/mol-model/structure';
import { Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';

export type MutableFrame = Frame;
type Pair = [number, number];
type Triple = [number, number, number];
type Quad = [number, number, number, number];

function getPoint(frame: MutableFrame, atomIndex: number) {
    return Vec3.create(frame.x[atomIndex], frame.y[atomIndex], frame.z[atomIndex]);
}

function setPoint(frame: MutableFrame, atomIndex: number, point: Vec3) {
    (frame.x as Float32Array | Float64Array)[atomIndex] = point[0];
    (frame.y as Float32Array | Float64Array)[atomIndex] = point[1];
    (frame.z as Float32Array | Float64Array)[atomIndex] = point[2];
}

function translateAtoms(frame: MutableFrame, atomIndices: readonly number[], delta: Vec3) {
    const point = Vec3.zero();
    for (const atomIndex of atomIndices) {
        Vec3.add(point, getPoint(frame, atomIndex), delta);
        setPoint(frame, atomIndex, point);
    }
}

function rotateAtoms(frame: MutableFrame, atomIndices: readonly number[], origin: Vec3, axis: Vec3, angleInRadians: number) {
    const transform = Mat4.fromRotation(Mat4(), angleInRadians, axis);
    const relative = Vec3.zero();
    const rotated = Vec3.zero();
    for (const atomIndex of atomIndices) {
        Vec3.sub(relative, getPoint(frame, atomIndex), origin);
        Vec3.transformMat4(rotated, relative, transform);
        Vec3.add(rotated, rotated, origin);
        setPoint(frame, atomIndex, rotated);
    }
}

function clampCosine(value: number) {
    return Math.max(-1, Math.min(1, value));
}

function radiansToDegrees(radians: number) {
    return radians * 180 / Math.PI;
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

export function measureDistance(frame: MutableFrame, [a, b]: Pair) {
    return Vec3.distance(getPoint(frame, a), getPoint(frame, b));
}

export function measureAngle(frame: MutableFrame, [a, b, c]: Triple) {
    const ba = Vec3.sub(Vec3(), getPoint(frame, a), getPoint(frame, b));
    const bc = Vec3.sub(Vec3(), getPoint(frame, c), getPoint(frame, b));
    const baLength = Vec3.magnitude(ba);
    const bcLength = Vec3.magnitude(bc);
    if (baLength < 1e-6 || bcLength < 1e-6) {
        throw new Error('Cannot measure angle for coincident atoms.');
    }
    return radiansToDegrees(Math.acos(clampCosine(Vec3.dot(ba, bc) / (baLength * bcLength))));
}

export function measureDihedral(frame: MutableFrame, [a, b, c, d]: Quad) {
    const p0 = getPoint(frame, a);
    const p1 = getPoint(frame, b);
    const p2 = getPoint(frame, c);
    const p3 = getPoint(frame, d);

    const b0 = Vec3.sub(Vec3(), p1, p0);
    const b1 = Vec3.sub(Vec3(), p2, p1);
    const b2 = Vec3.sub(Vec3(), p3, p2);

    const b1Length = Vec3.magnitude(b1);
    if (b1Length < 1e-6) {
        throw new Error('Cannot measure dihedral for coincident middle atoms.');
    }
    Vec3.scale(b1, b1, 1 / b1Length);

    const v = Vec3.sub(Vec3(), b0, Vec3.scale(Vec3(), b1, Vec3.dot(b0, b1)));
    const w = Vec3.sub(Vec3(), b2, Vec3.scale(Vec3(), b1, Vec3.dot(b2, b1)));
    const x = Vec3.dot(v, w);
    const y = Vec3.dot(Vec3.cross(Vec3(), b1, v), w);
    return wrapDegrees(radiansToDegrees(Math.atan2(y, x)));
}

export function applyDistanceConstraint(frame: MutableFrame, [a, b]: Pair, movableAtomIndices: readonly number[], target: number) {
    const anchor = getPoint(frame, a);
    const movable = getPoint(frame, b);
    const direction = Vec3.sub(Vec3(), movable, anchor);
    const length = Vec3.magnitude(direction);
    if (length < 1e-6) {
        throw new Error('Cannot edit distance for coincident atoms.');
    }
    Vec3.scale(direction, direction, 1 / length);
    const targetPoint = Vec3.scaleAndAdd(Vec3(), anchor, direction, target);
    const delta = Vec3.sub(Vec3(), targetPoint, movable);
    translateAtoms(frame, movableAtomIndices, delta);
    frame.time.value += 1;
}

export function applyAngleConstraint(frame: MutableFrame, [a, b, c]: Triple, movableAtomIndices: readonly number[], target: number) {
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
    const delta = degreesToRadians(target - current);
    rotateAtoms(frame, movableAtomIndices, pointB, normal, delta);
    frame.time.value += 1;
}

export function applyDihedralConstraint(frame: MutableFrame, [a, b, c, d]: Quad, movableAtomIndices: readonly number[], target: number) {
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
    const delta = degreesToRadians(wrapDegrees(target - current));
    rotateAtoms(frame, movableAtomIndices, pointC, axis, delta);
    frame.time.value += 1;
}
