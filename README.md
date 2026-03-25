# molstar-structure-editor

Realtime structure editing plugin package for Mol*.

## What it does

- Explicit edit mode
- Selection-based rigid-body move and rotate
- Pickable gizmo with translation axes and rotation rings
- Realtime coordinate updates on the actual Mol* structure representation
- Commit and cancel for the current edit session

## Install

```bash
npm install
```

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Test In A Web Page

Start the example dev server:

```bash
npm run dev:example
```

Then open:

```text
http://localhost:4173
```

If the page appears to "twitch" or fully reload repeatedly, make sure you are not running a parallel watch process that writes into `dist/`. The example dev server is configured to ignore `dist/`, but a second watcher rebuilding the package can still create noisy reload behavior in some setups.

## Example Workflow

1. Wait for the example structure to load.
2. Click atoms to create a Mol* selection.
3. Use the floating `Move` or `Rotate` button.
4. Click a gizmo axis or ring.
5. Drag in the viewport to edit coordinates in realtime.
6. Press `Enter` or click `Apply` to keep the edit.
7. Press `Escape` or click `Cancel` to revert the current session.

## Current v1 Limits

- Single selected structure only
- Identity operator units only
- Rigid-body edits only
- No undo/redo stack yet
- No bond recomputation or chemistry editing yet
