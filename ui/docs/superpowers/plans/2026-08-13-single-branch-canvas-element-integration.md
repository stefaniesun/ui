# Single-Branch Canvas and Element Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the ComfyUI-style canvas in `feature/region-split` while retaining region boundary controls and the complete region-element analysis/editing workflow.

**Architecture:** Use `feature/region-split` as the only integration branch. First import the revision-safe element document/core/API layer, then bring in the canvas shell and adapt its nodes to the newer store rather than replacing the store with the older canvas version. Element overlays remain image-coordinate components; the canvas node only supplies viewport and node placement.

**Tech Stack:** TypeScript, Vue 3, Vite, Fastify, Zod, Vitest, pnpm.

---

### Task 1: Import the element document and editing baseline

**Files:**
- Modify: `packages/region-split/src/types.ts`
- Modify: `packages/region-split/src/store.ts`
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/analyze.ts`
- Create: `packages/region-split/src/elements.ts`
- Create: `packages/region-split/src/element-analysis.ts`
- Create: `packages/region-split/src/write-coordinator.ts`
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/state.ts`
- Create: `apps/region-split-ui/src/components/ElementOverlay.vue`
- Create: `apps/region-split-ui/src/components/ElementTree.vue`
- Test: corresponding `*.test.ts` files beside these modules

- [ ] Import the reviewed commits from `feature/region-element-components` in their existing order.
- [ ] Run `pnpm --dir packages/region-split test` and verify all core tests pass.
- [ ] Run `pnpm --dir apps/region-split-ui test` and verify all UI baseline tests pass.

### Task 2: Restore the ComfyUI-style canvas shell

**Files:**
- Create: `apps/region-split-ui/src/theme.css`
- Create: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Create: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Create: `apps/region-split-ui/src/canvas/PipelineNode.vue`
- Create: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Create: `apps/region-split-ui/src/components/ActionBar.vue`
- Create: `apps/region-split-ui/src/components/ErrorDialog.vue`
- Create: `apps/region-split-ui/src/components/RegionCanvas.vue`
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/main.ts`
- Test: canvas and component tests beside these modules

- [ ] Merge the canvas branch without accepting its older `state.ts`, API, or core behavior over the element baseline.
- [ ] Keep canvas pan, zoom, fit-view, draggable node position, dark theme, automatic upload analysis, and in-app errors.
- [ ] Run the canvas component tests and verify the restored shell renders and responds to interactions.

### Task 3: Integrate elements into the canvas result node

**Files:**
- Modify: `apps/region-split-ui/src/components/RegionCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/App.vue`
- Test: `apps/region-split-ui/src/components/RegionCanvas.test.ts`
- Test: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Test: `apps/region-split-ui/src/App.test.ts`

- [ ] Add failing tests proving element overlays and the element tree are visible in the canvas workspace.
- [ ] Pass the current element selection, hover, create, move, resize, reparent, delete, and retry actions through `RegionsNode`.
- [ ] Preserve region selection, boundary controls, split/merge, rename, AI rename, undo/redo, keyboard actions, and conflict handling.
- [ ] Run UI tests and verify both canvas and element contracts pass together.

### Task 4: Verify the integrated single branch

**Files:**
- Verify all changed source and test files

- [ ] Run `pnpm --dir packages/region-split test`.
- [ ] Run `pnpm --dir packages/region-split typecheck`.
- [ ] Run `pnpm --dir apps/region-split-ui test`.
- [ ] Run `pnpm --dir apps/region-split-ui typecheck`.
- [ ] Run `pnpm --dir apps/region-split-ui build`.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Commit only integration files, preserve the local `.npmrc`, and push `feature/region-split`.
- [ ] Remove the two obsolete feature worktrees and delete their local branches after the push succeeds.
- [ ] Restart both services from `D:/workspace/ui` and verify ports `4800` and `5180` respond.
