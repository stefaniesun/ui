import { describe, expect, it } from 'vitest'
import { runRefinement } from './run.js'

const quality = (total: number) => ({
  total,
  regions: [{ regionId: 'hero', total, critical: true, geometryErrorPx: 2, ocrMatch: .99, severeDefects: [] }],
  code: { types: true, lint: true, componentContract: true },
})

describe('runRefinement', () => {
  it('runs phases, accepts a patch, then renders and measures the restored best snapshot', async () => {
    const snapshots: string[] = []
    const restored: string[] = []
    const rendered: number[] = []
    let measured = 0
    let file = 'before'
    const result = await runRefinement({
      workspace: {
        async createSnapshot(label) { snapshots.push(label); return label },
        async restoreSnapshot(id) { restored.push(id) },
        async write(_path, content) { file = content },
      },
      boundary: {
        bindings: [{ regionId: 'hero', componentPath: 'src/Hero.vue', componentName: 'Hero' }],
        stateIds: ['default'],
        targets: ['h5'],
      },
      async ingest() {},
      async analyze() {},
      async generate() {},
      async render(round) { rendered.push(round) },
      async measure() { measured += 1; return quality(.86) },
      async diagnose() {
        return {
          plan: {
            targetRegionIds: ['hero'],
            rootCause: 'spacing',
            allowedFiles: ['src/Hero.vue'],
            allowedComponents: ['Hero'],
            allowedTokens: [],
            expectedMetricChanges: { total: .03 },
            affectedStateIds: ['default'],
            affectedTargets: ['h5'],
            rollbackConditions: ['regression'],
            replacementFiles: { 'src/Hero.vue': 'after' },
          },
          payload: { 'src/Hero.vue': 'after' },
        }
      },
      async regress() { return quality(.89) },
    }, 8)
    expect(result.reason).toBe('passed')
    expect(result.bestRound).toBe(1)
    expect(file).toBe('after')
    expect(restored).toContain('round-1')
    expect(rendered).toEqual([0, 1])
    expect(measured).toBe(2)
    expect(result.journal.filter(entry => entry.status === 'completed').map(entry => entry.state)).toEqual([
      'INGEST', 'ANALYZE', 'GENERATE', 'RENDER', 'MEASURE', 'DIAGNOSE', 'PATCH', 'REGRESSION',
    ])
  })
})
