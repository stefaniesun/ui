# Region Detail Width-Driven Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all image-area gaps by deriving image height from its rendered width and source aspect ratio, while narrowing the AI column.

**Architecture:** Keep only column proportions in shared persistent state. `DetailNode.vue` observes the workspace width, derives the first two columns' pixel width, and sets the image grid row to the exact source-ratio height; the lower inspector keeps a fixed usable height. The overlay stage fills this exact-ratio box, so no contain gaps or scrolling are needed.

**Tech Stack:** Vue 3 Composition API, ResizeObserver, TypeScript, CSS Grid, localStorage, Vitest.

---

### Task 1: Migrate shared proportions

**Files:**
- Modify: `apps/region-split-ui/src/region-detail-layout.ts`
- Modify: `apps/region-split-ui/src/region-detail-layout.test.ts`

- [ ] Update tests to require defaults `{ tree: 40, ai: 20 }`, constrain AI to 15–30, preserve tree/property minimum 15, and migrate old records containing `image`.
- [ ] Run the state test and verify it fails.
- [ ] Remove `image` from the state interface and normalization. Implement the new defaults and constraints.
- [ ] Run the state test and verify it passes.

### Task 2: Derive image height from rendered width

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] Update component tests to require only column values and two vertical separators; require an image aspect-ratio variable and no row separator.
- [ ] Run the component test and verify it fails.
- [ ] Observe workspace width, compute `(workspace width × (100 - ai) / 100) × region.h / region.w`, and expose it as the exact first-row pixel height.
- [ ] Remove row dragging, row keyboard behavior, row separator, and image/element values.
- [ ] Change the grid to `calculated image height + fixed inspector height`; make the image stage fill that row without contain gaps.
- [ ] Keep tree and AI separators draggable and persistent.
- [ ] Run focused tests and verify they pass.

### Task 3: Narrow AI controls and verify

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementRefactorPanel.vue`

- [ ] Allow the AI action row to wrap and ensure the textarea has zero intrinsic minimum width.
- [ ] Run all UI tests, typecheck, and production build.
- [ ] Open the real page and verify image flush edges, no scrollbars, smaller AI width, dragging, persistence, and reset.
- [ ] Stage only target files and docs, exclude `.npmrc`, commit, and push through `127.0.0.1:12334`.
