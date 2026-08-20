# Region Detail Resizable Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the region-recognition detail image height and its three panel widths globally draggable, visible, persistent, and resettable.

**Architecture:** A focused module owns the shared reactive layout state, constraints, serialization, and reset behavior. `DetailNode.vue` renders three accessible separators, converts pointer/keyboard input into percentages, and applies those values through CSS custom properties without changing the image contain behavior.

**Tech Stack:** Vue 3 Composition API, TypeScript, CSS Grid, localStorage, Vitest, Vue Test Utils.

---

### Task 1: Shared layout state

**Files:**
- Create: `apps/region-split-ui/src/region-detail-layout.ts`
- Create: `apps/region-split-ui/src/region-detail-layout.test.ts`

- [ ] **Step 1: Write failing tests**

Test default values, invalid saved JSON fallback, clamping, persistence, shared state, and reset.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/region-detail-layout.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal state module**

Export `regionDetailLayout`, `setRegionDetailLayout()`, and `resetRegionDetailLayout()`. Keep `image`, `tree`, and `ai`; derive property width as `100 - tree - ai`. Enforce image 35–80, AI 18–45, and tree/property minimum 15. Save valid values under one localStorage key.

- [ ] **Step 4: Run tests and verify pass**

Run the Task 1 command.
Expected: PASS.

### Task 2: Accessible drag controls and live values

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] **Step 1: Write failing component tests**

Require the live ratio summary, reset button, horizontal image separator, tree separator, and AI separator. Require keyboard arrows to update the shared values.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts`
Expected: FAIL because controls are absent.

- [ ] **Step 3: Render and wire controls**

Apply CSS variables for row and column ratios. On pointer movement, calculate percentages from the workspace rectangle and call the constrained state setter. Add `role="separator"`, orientation, value attributes, keyboard arrows, live text, and reset button.

- [ ] **Step 4: Preserve image behavior and style handles**

Keep `.image-fit` overflow hidden and the overlay contain sizing. Position handles over grid boundaries, show resize cursors, and disable selection while dragging.

- [ ] **Step 5: Run focused tests and verify pass**

Run both Task 1 and Task 2 test files.
Expected: PASS.

### Task 3: Regression and browser verification

**Files:**
- Verify only; no new production files expected.

- [ ] **Step 1: Run all UI tests**

Run: `pnpm --filter @region-split/ui test -- --run --reporter=default`
Expected: all tests pass.

- [ ] **Step 2: Run typecheck and production build**

Run: `pnpm --filter @region-split/ui typecheck`
Run: `pnpm --filter @region-split/ui exec vite build --emptyOutDir false --clearScreen false`
Expected: both exit 0.

- [ ] **Step 3: Verify in browser**

Open the running UI, drag all three separators, confirm the ratio text changes, confirm the image remains fully visible without scrollbars, refresh and confirm values persist, then reset.

- [ ] **Step 4: Commit and push**

Stage only the new state module, tests, `DetailNode` changes, spec, and plan. Exclude `.npmrc`. Push `feature/region-split` through `127.0.0.1:12334`.
