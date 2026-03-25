---
name: molstar-structure-editor-debug
description: Use when the molstar-structure-editor plugin has broken gizmo picking, dragging that rotates the camera instead, stale structure rendering, selection resolution failures, or commit/cancel state issues.
---

# Molstar Structure Editor Debug

## Overview
Most bugs in this plugin fall into one of four buckets: selection resolution, pointer routing, projection math, or coordinate-backed structure rendering.

## Debug Order
1. Confirm a session exists.
2. Confirm the gizmo is projected where it is actually drawn.
3. Confirm pointer input reaches the controller only when gizmo handles are hit.
4. Confirm coordinate updates target `ModelWithCoordinates`.
5. Confirm the visible structure branch comes from the coordinate-backed model.

## Symptom to Cause Map
- `Move` or `Rotate` does nothing
  Likely no valid session, no effective selection, or missed gizmo hit.
- Dragging rotates the camera instead of moving atoms
  Pointer did not hit a gizmo handle, or hit thresholds are too small.
- Dragging updates internal coordinates but the view does not change
  The visible structure branch is still the original structure, not the edited one.
- Mouse feels offset from the gizmo
  Screen projection math is wrong, commonly a viewport-to-client Y inversion bug.
- Commit keeps strange stale state
  Source/preview structure refs were not swapped or cleaned up correctly.

## What to Inspect
- Controller state in `src/behavior.ts`
  Check `state`, `session`, `dragOperation`, `pointerHost`, `sourceStructureRef`, `previewStructureRef`.
- Selection resolution in `src/selection-target.ts`
  Confirm only one structure is selected.
- Coordinate bridge in `src/coordinate-updater.ts`
  Confirm updates go through `ModelWithCoordinates`.
- Projection and picking in `src/behavior.ts` plus `src/gizmo-hit-test.ts`
  Confirm rendered scale and hit scale match.

## Browser Checks
- Open the example viewer and select a small atomic target.
- Prefer `Spacefill` during debugging; `Cartoon` can hide local movement.
- In edit mode:
  - dragging empty space should move the camera
  - dragging a handle should move or rotate only the selected atoms
- If the gizmo feels offset, verify projected handle points against the rendered gizmo before changing thresholds.

## Fix Strategy
- Fix root cause first, then widen thresholds only if needed.
- Do not compensate for projection bugs by endlessly inflating hit areas.
- Do not update the source structure branch directly during live drag; keep the coordinate-backed branch as the visible edited structure.

## Useful Commands
```bash
cd /home/ylj/应用/molstar/molstar-structure-editor
npm run dev:example
npm test
npm run typecheck
npm run build
```

