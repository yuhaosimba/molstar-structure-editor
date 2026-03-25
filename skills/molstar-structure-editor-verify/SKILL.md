---
name: molstar-structure-editor-verify
description: Use before claiming a molstar-structure-editor change is complete, fixed, or ready to commit, especially after touching interaction code, coordinate updates, or the example viewer.
---

# Molstar Structure Editor Verify

## Overview
This plugin needs both automated verification and a quick interactive sanity check. Passing tests alone are not enough for gizmo and Mol* viewport changes.

## Required Commands
Run from `/home/ylj/应用/molstar/molstar-structure-editor`:

```bash
npm test
npm run typecheck
npm run build
```

## Manual Smoke Test
1. Start the example:
   ```bash
   npm run dev:example
   ```
2. Open the local viewer.
3. Select a small atomic target.
4. Switch to `Spacefill`.
5. Click `Move`.
6. Drag a gizmo axis and confirm the selected region moves.
7. Drag empty space and confirm the camera still rotates when not actively dragging a handle.
8. Click `Rotate` and confirm a ring drag changes orientation.
9. Use `Apply`, then start a new edit and confirm the new pose is the baseline.
10. Use `Cancel` on a fresh edit and confirm the pose resets.

## Change-Specific Checks
- If you touched `src/behavior.ts`
  Re-test selection, pointer routing, commit/cancel, and camera interaction.
- If you touched `src/gizmo-representation.ts` or `src/gizmo-hit-test.ts`
  Re-test visible handle placement and how easy handles are to pick.
- If you touched `src/coordinate-updater.ts` or `src/session.ts`
  Re-test that edited coordinates visibly update in the viewport and persist across `Apply`.

## Release Note Template
- What behavior changed
- Which files were touched
- Which automated checks passed
- Which manual interaction path was exercised
