import { GizmoHandleId } from './gizmo-representation';

export type Point = readonly [number, number];

type GizmoScreenPoints = {
    translate: Record<'x' | 'y' | 'z', Point>
    rotate: Record<'x' | 'y' | 'z', Point[]>
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
    return getClosestPointOnSegment(point, start, end).distance;
}

function getClosestPointOnSegment(point: Point, start: Point, end: Point) {
    const sx = end[0] - start[0];
    const sy = end[1] - start[1];
    const len2 = sx * sx + sy * sy;
    if (len2 === 0) return { distance: Math.sqrt(distance2(point, start)), t: 0 };
    let t = ((point[0] - start[0]) * sx + (point[1] - start[1]) * sy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projected: Point = [start[0] + t * sx, start[1] + t * sy];
    return { distance: Math.sqrt(distance2(point, projected)), t };
}

function distanceToRing(point: Point, center: Point, sample: Point) {
    const radius = Math.sqrt(distance2(center, sample));
    return Math.abs(Math.sqrt(distance2(point, center)) - radius);
}

export function getClosestPolylineSegment(point: Point, polyline: Point[]) {
    if (polyline.length < 2) return void 0;
    let best: { distance: number; start: Point; end: Point } | undefined;
    for (let i = 0, il = polyline.length; i < il; i++) {
        const start = polyline[i];
        const end = polyline[(i + 1) % il];
        const distance = distancePointToSegment(point, start, end);
        if (!best || distance < best.distance) {
            best = { distance, start, end };
        }
    }
    return best;
}

export function pickGizmoHandleAtPoint(center: Point, points: GizmoScreenPoints, pointer: Point, options: HitTestOptions = {}): GizmoHandleId | undefined {
    const translateThreshold = options.translateThreshold ?? 36;
    const rotateThreshold = options.rotateThreshold ?? 30;

    const translations: Array<[GizmoHandleId, Point]> = [
        ['translate-x', points.translate.x],
        ['translate-y', points.translate.y],
        ['translate-z', points.translate.z],
    ];

    let bestTranslate: { handle: GizmoHandleId; distance: number; t: number } | undefined;
    for (const [handle, end] of translations) {
        const hit = getClosestPointOnSegment(pointer, center, end);
        const distance = hit.distance;
        if (distance <= translateThreshold && (!bestTranslate || distance < bestTranslate.distance)) {
            bestTranslate = { handle, distance, t: hit.t };
        }
    }

    const rotations: Array<[GizmoHandleId, Point[]]> = [
        ['rotate-x', points.rotate.x],
        ['rotate-y', points.rotate.y],
        ['rotate-z', points.rotate.z],
    ];

    let bestRotate: { handle: GizmoHandleId; distance: number } | undefined;
    for (const [handle, polyline] of rotations) {
        const distance = polyline.length > 1
            ? getClosestPolylineSegment(pointer, polyline)?.distance ?? Number.POSITIVE_INFINITY
            : distanceToRing(pointer, center, polyline[0] ?? center);
        if (distance <= rotateThreshold && (!bestRotate || distance < bestRotate.distance)) {
            bestRotate = { handle, distance };
        }
    }

    if (bestTranslate && bestRotate) {
        if (bestTranslate.t >= 0.65 && bestTranslate.distance <= bestRotate.distance) {
            return bestTranslate.handle;
        }
        return bestRotate.distance / rotateThreshold <= bestTranslate.distance / translateThreshold
            ? bestRotate.handle
            : bestTranslate.handle;
    }

    return bestTranslate?.handle ?? bestRotate?.handle;
}
