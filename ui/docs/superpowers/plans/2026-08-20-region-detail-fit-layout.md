# Region Detail Fit Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the region detail node at its current height while showing the complete region image without horizontal or vertical scrollbars.

**Architecture:** `DetailNode` supplies a bounded, overflow-hidden viewport. `ElementOverlay` owns a full-size fit container and uses CSS sizing constraints to contain its aspect-ratio stage; image, boxes, dragging, and picking remain in the same coordinate system. The lower inspector and right AI panel keep independent internal overflow.

**Tech Stack:** Vue 3 SFC, CSS Grid, Vitest, Vue Test Utils, TypeScript, Vite

---

### Task 1: Lock the no-scroll fit contract

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementOverlay.test.ts`

- [ ] **Step 1: Write failing detail layout assertions**

Extend the existing layout test to require a dedicated fit viewport around `ElementOverlay`, keeping the inspector below it and AI at the right.

- [ ] **Step 2: Write failing overlay fit assertions**

Require `ElementOverlay` to render a `data-test="element-fit"` wrapper around the stage. Keep the stage aspect-ratio assertion and percentage box assertions unchanged.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts src/components/ElementOverlay.test.ts
```

Expected: FAIL because `element-fit` does not exist yet.

### Task 2: Implement complete image fitting

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/components/ElementOverlay.vue`

- [ ] **Step 1: Replace the scroll viewport**

Rename the detail image body from scroll semantics to fit semantics. Make it `overflow: hidden`, center its child, and keep the color preview positioned relative to the actual stage.

- [ ] **Step 2: Add the overlay fit container**

Wrap the stage with `.fit`; make the wrapper fill available width and height and center its child. Size the stage with:

```css
.stage {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: var(--region-aspect);
}
```

Use a computed inline style containing both the aspect ratio and a width/height candidate that guarantees contain behavior for wide and tall regions. Keep `.crop` at `width: 100%; height: 100%` so overlays remain aligned.

- [ ] **Step 3: Improve fixed-height proportions**

Use approximately `65% / 35%` for image and inspector rows and widen the AI column to `300px`. Preserve the fixed `500px` workspace height.

- [ ] **Step 4: Run focused tests and verify pass**

Run the Task 1 command. Expected: all focused tests PASS.

- [ ] **Step 5: Commit implementation**

```powershell
git add -- apps/region-split-ui/src/canvas/nodes/DetailNode.vue apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts apps/region-split-ui/src/components/ElementOverlay.vue apps/region-split-ui/src/components/ElementOverlay.test.ts
git commit -m "fix: fit region image without scrollbars"
```

### Task 3: Regression and browser verification

**Files:**
- Verify: `apps/region-split-ui`

- [ ] **Step 1: Run all UI tests**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck and build**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui build
```

Expected: both commands exit `0`.

- [ ] **Step 3: Inspect the real page**

Open the running UI, focus a parsed region detail, and confirm: the full region image is visible, neither image-axis has a scrollbar, element boxes align, element inspector remains below, and AI remains on the right.

- [ ] **Step 4: Push through the configured proxy**

```powershell
git -c http.proxy=http://127.0.0.1:12334 -c https.proxy=http://127.0.0.1:12334 push origin feature/region-split
```

Expected: remote branch advances successfully.
