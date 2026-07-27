# Civic Three.js Preview

## Commands

- `npm install`
- `node .\scripts\patch-civic-spec.mjs`
- `npm run validate:spec`
- `npm run generate:blockout`
- `npm run dev`
- `npm test`
- `npm run build`

## Workflow

This is a Windows-local workflow that assumes PowerShell-style paths and script invocation.

1. Patch the Civic sculpt spec with `node .\scripts\patch-civic-spec.mjs`; this rewrites `civvi/analysis/stage2-object-sculpt-spec.json`.
2. Validate the spec with `npm run validate:spec`; as of July 27, 2026, this passes with many quality warnings, and `blockout` remains locked for the next pass until a browser screenshot and self-correction review are completed.
3. Generate the TypeScript factory with `npm run generate:blockout`; this rewrites `src/generated/civic-blockout.ts`.
4. Start the preview with `npm run dev`.
5. Open the Vite URL and inspect front, side, rear three-quarter, and top-informed silhouette reads.

## Current milestone

This milestone delivers an orbitable and zoomable exterior preview with a generated blockout plus handwritten refinement for lenses and wheel faces.
