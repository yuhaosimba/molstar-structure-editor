import { GizmoHandleId } from './gizmo-representation';

type Point = readonly [number, number];

type GizmoScreenPoints = {
    translate: Record<'x' | 'y' | 'z', Point>
    rotate: Record<'x' | 'y' | 'z', Point>
};

type HitTestOptions = {
    translateThreshold?: number
    rotateThreshold?: number
};

function distance2(a: Point, b: Point) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function distancePointToSegment(point: Point, start: Point, end: Point) {
    const sx = end[0] - start[0];
    const sy = end[1] - start[1];
    const len2 = sx * sx + sy * sy;
    if (len2 === 0) return Math.sqrt(distance2(point, start));
    let t = ((point[0] - start[0]) * sx + (point[1] - start[1]) * sy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projected: Point = [start[0] + t * sx, start[1] + t * sy];
    return Math.sqrt(distance2(point, projected));
}

function distanceToRing(point: Point, center: Point, sample: Point) {
    const radius = Math.sqrt(distance2(center, sample));
    return Math.abs(Math.sqrt(distance2(point, center)) - radius);
}

export function pickGizmoHandleAtPoint(center: Point, points: GizmoScreenPoints, pointer: Point, options: HitTestOptions = {}): GizmoHandleId | undefined {
    const translateThreshold = options.translateThreshold ?? 36;
    const rotateThreshold = options.rotateThreshold ?? 30;

    const translations: Array<[GizmoHandleId, Point]> = [
        ['translate-x', points.translate.x],
        ['translate-y', points.translate.y],
        ['translate-z', points.translate.z],
    ];

    let bestTranslate: { handle: GizmoHandleId; distance: number } | undefined;
    for (const [handle, end] of translations) {
        const distance = distancePointToSegment(pointer, center, end);
        if (distance <= translateThreshold && (!bestTranslate || distance < bestTranslate.distance)) {
            bestTranslate = { handle, distance };
        }
    }
    if (bestTranslate) return bestTranslate.handle;

    const rotations: Array<[GizmoHandleId, Point]> = [
        ['rotate-x', points.rotate.x],
        ['rotate-y', points.rotate.y],
        ['rotate-z', points.rotate.z],
    ];

    let bestRotate: { handle: GizmoHandleId; distance: number } | undefined;
    for (const [handle, sample] of rotations) {
        const distance = distanceToRing(pointer, center, sample);
        if (distance <= rotateThreshold && (!bestRotate || distance < bestRotate.distance)) {
            bestRotate = { handle, distance };
        }
    }
    return bestRotate?.handle;
}
