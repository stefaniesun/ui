# Civic Three.js Preview

## Commands

- `npm install`
- `npm run validate:spec`
- `npm run generate:blockout`
- `npm run dev`
- `npm test`
- `npm run build`

## Workflow

1. Patch the Civic sculpt spec with `node .\scripts\patch-civic-spec.mjs`.
2. Validate the spec with `npm run validate:spec`.
3. Generate the TypeScript factory with `npm run generate:blockout`.
4. Start the preview with `npm run dev`.
5. Open the Vite URL and inspect front, side, rear three-quarter, and top-informed silhouette reads.

## Current milestone

This milestone delivers an orbitable and zoomable exterior preview with a generated blockout plus handwritten refinement for lenses and wheel faces.
