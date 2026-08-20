# Region Detail Column Proportions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the region detail workspace as a 36% / 36% / 28% three-column grid while preserving the fixed height and scrollbar-free fitted image.

**Architecture:** `DetailNode` becomes the single grid owner. The image spans columns one and two in row one; the tree and properties occupy columns one and two in row two; the AI panel occupies column three across both rows. Existing child components retain their own internal scrolling behavior.

**Tech Stack:** Vue 3 SFC, CSS Grid, Vitest, Vue Test Utils, TypeScript, Vite

---

### Task 1: Lock the three-column grid contract

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] **Step 1: Write the failing test**

Update the layout test to require `detail-image`, `detail-inspector`, and `detail-ai-column` to be direct children of `detail-workspace`. Require the inspector to contain the tree and properties components in that order.

- [ ] **Step 2: Run the focused test**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts
```

Expected: FAIL because the image and inspector are still wrapped in `detail-main`.

### Task 2: Implement the 36 / 36 / 28 layout

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`

- [ ] **Step 1: Flatten the workspace structure**

Remove `detail-main`. Keep this direct-child order under `detail-workspace`: image section, inspector section, AI aside.

- [ ] **Step 2: Define the outer grid**

Set the workspace grid to:

```css
grid-template-columns: minmax(0, 36fr) minmax(0, 36fr) minmax(0, 28fr);
grid-template-rows: minmax(0, 13fr) minmax(0, 7fr);
```

Place image at `grid-column: 1 / 3; grid-row: 1`, inspector at `grid-column: 1 / 3; grid-row: 2`, and AI at `grid-column: 3; grid-row: 1 / 3`.

- [ ] **Step 3: Split the lower inspector equally**

Use `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)` so the tree and properties each receive 36% of the total workspace width.

- [ ] **Step 4: Run focused tests**

Run the Task 1 command. Expected: all `DetailNode` tests PASS.

### Task 3: Verify and deliver

**Files:**
- Verify: `apps/region-split-ui`

- [ ] **Step 1: Run all UI tests**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test -- --run
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck and build**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vite build --emptyOutDir false
```

Expected: both commands exit `0`.

- [ ] **Step 3: Inspect the running page**

Confirm the image spans the first two columns, tree and properties are equal width below it, AI occupies 28% at the right, and the image viewport has no scrollbar.

- [ ] **Step 4: Commit and push**

```powershell
git add -- docs/superpowers/plans/2026-08-20-region-detail-column-proportions.md apps/region-split-ui/src/canvas/nodes/DetailNode.vue apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts
git commit -m "fix: balance region detail columns"
git -c http.proxy=http://127.0.0.1:12334 -c https.proxy=http://127.0.0.1:12334 push origin feature/region-split
```

Expected: the remote branch advances successfully and `.npmrc` remains uncommitted.
