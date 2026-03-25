---
name: molstar-structure-editor-dev
description: Use when modifying the molstar-structure-editor plugin, extending edit behavior, changing gizmo interaction, or working on Mol* coordinate-driven structure editing in this repository.
---

# Molstar Structure Editor Dev

## Overview
This plugin edits structures by continuously replacing selected atom coordinates and letting Mol* redraw from the updated model. It does not mutate the original trajectory frame in place.

## When to Use
- Adding move, rotate, commit, or cancel behavior
- Extending selection handling
- Changing how edited structures are shown in Mol*
- Modifying gizmo rendering or input flow

## Architecture
- `src/helpers.ts`
  Public entrypoints: register plugin, enter move/rotate, commit, cancel.
- `src/behavior.ts`
  Main controller. Owns state machine, toolbar, pointer handling, gizmo placement, and edit-mode structure swapping.
- `src/session.ts`
  Edit math. Freezes selected atom indices, stores base/current frames, applies rigid translation/rotation.
- `src/coordinate-updater.ts`
  Inserts or reuses `ModelWithCoordinates`, then updates `atomicCoordinateFrame`.
- `src/gizmo-representation.ts`
  Builds the visible axes/rings mesh.
- `src/gizmo-hit-test.ts`
  Screen-space picking for axes and rings.
- `src/selection-target.ts`
  Resolves the active Mol* selection to a single editable structure target.

## Core Data Flow
1. User selects atoms or residues in Mol*.
2. `enterMode()` in `src/behavior.ts` creates an `EditSession`.
3. `CoordinateUpdater` ensures a `ModelWithCoordinates` node exists under the selected model.
4. A temporary structure branch is built from that coordinate-backed model and shown while the source structure is hidden.
5. Pointer drag updates the session transform.
6. Session rebuilds `currentFrame` for selected atoms only.
7. `CoordinateUpdater` pushes the new frame into Mol*.
8. Mol* redraws the edited structure branch.

## Rules for Safe Changes
- Keep v1 scoped to one structure and one model.
- Treat selection as rigid-body editing unless you are explicitly adding internal deformation support.
- When changing screen-space math, keep `behavior.ts` projection logic and `gizmo-hit-test.ts` thresholds in sync.
- When changing coordinate updates, verify the visible structure branch still comes from the coordinate-backed model, not the hidden source branch.

## Common Extension Points
- Add hover feedback: start in `src/behavior.ts` and pass `activeHandle` into the gizmo transform.
- Add new edit modes: extend `EditKind`, session math, and toolbar commands together.
- Support better chemical editing: add a new post-transform relaxation or topology-aware layer above `session.ts`. Do not overload `ModelWithCoordinates` with chemistry logic.

## Fast References
- Public API: `src/index.ts`, `src/helpers.ts`
- Edit session math: `src/session.ts`
- Mol* coordinate bridge: `src/coordinate-updater.ts`
- Pointer bugs: `src/behavior.ts`, `src/gizmo-hit-test.ts`

