import type { PatchPlanInput } from '@ui-rebuild/contracts'
import { evaluateGates, validateQuality } from './gates.js'
import type { QualitySnapshot } from './gates.js'
import { applyInSnapshot } from './patch-runner.js'
import type { PatchBoundary, PatchPayload, SnapshotWorkspace } from './patch-runner.js'
import { SnapshotStore } from './snapshot-store.js'
import { StateJournal } from './state-machine.js'

export type StopReason = 'passed' | 'stalled' | 'max-rounds' | 'error'
export interface RefinementDependencies {
  workspace: SnapshotWorkspace
  boundary: PatchBoundary
  ingest(): Promise<void>
  analyze(): Promise<void>
  generate(): Promise<void>
  render(round: number): Promise<void>
  measure(round: number): Promise<QualitySnapshot>
  diagnose(round: number, quality: QualitySnapshot): Promise<{ plan: PatchPlanInput; payload: PatchPayload }>
  regress(round: number): Promise<QualitySnapshot>
}
export interface RefinementResult {
  reason: StopReason
  bestRound: number
  bestSnapshotId: string
  history: Array<{ round: number; decision: string; quality?: number; error?: string }>
  journal: StateJournal['entries']
}
const EPSILON = 1e-9

export function shouldStop(acceptedScores: readonly number[], maxRounds = 8) {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds must be a positive integer')
  if (acceptedScores.length - 1 >= maxRounds) return { stop: true, reason: 'max-rounds' as const }
  if (acceptedScores.length >= 3) {
    const [first, second, third] = acceptedScores.slice(-3)
    if (second! + EPSILON >= first! && third! + EPSILON >= second!
      && second! - first! < 0.005 - EPSILON && third! - second! < 0.005 - EPSILON) {
      return { stop: true, reason: 'stalled' as const }
    }
  }
  return { stop: false }
}

export function decideIteration(before: QualitySnapshot, after: QualitySnapshot, targetIds: string[]) {
  validateQuality(before)
  validateQuality(after)
  const previous = new Map(before.regions.map(region => [region.regionId, region]))
  const targetImproved = targetIds.every((id) => {
    const prior = previous.get(id)
    const next = after.regions.find(region => region.regionId === id)
    return Boolean(prior && next && next.total > prior.total + EPSILON)
  })
  const newSevereDefect = after.regions.some((region) => {
    const prior = new Set(previous.get(region.regionId)?.severeDefects ?? [])
    return region.severeDefects.some(defect => !prior.has(defect))
  })
  if (after.total + EPSILON < before.total || !targetImproved || newSevereDefect
    || !after.code.types || !after.code.lint || !after.code.componentContract) return 'revert'
  return evaluateGates(after).passed ? 'accept-and-stop' : 'accept-and-continue'
}

export async function runRefinement(deps: RefinementDependencies, maxRounds = 8): Promise<RefinementResult> {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds must be a positive integer')
  const journal = new StateJournal()
  const store = new SnapshotStore()
  const history: RefinementResult['history'] = []
  let quality: QualitySnapshot | undefined
  try {
    journal.start(0, 'INGEST'); await deps.ingest(); journal.complete()
    journal.start(0, 'ANALYZE'); await deps.analyze(); journal.complete()
    journal.start(0, 'GENERATE'); await deps.generate(); journal.complete()
    journal.start(0, 'RENDER'); await deps.render(0); journal.complete()
    journal.start(0, 'MEASURE'); quality = await deps.measure(0); journal.complete()
    validateQuality(quality)
    const baseSnapshotId = await deps.workspace.createSnapshot('round-0')
    store.add({ id: 'round-0', round: 0, quality, workspaceSnapshotId: baseSnapshotId })
    if (evaluateGates(quality).passed) return finish('passed', store, deps, history, journal)
    const acceptedScores = [quality.total]

    for (let round = 1; round <= maxRounds; round += 1) {
      journal.start(round, 'DIAGNOSE')
      const diagnosed = await deps.diagnose(round, quality)
      journal.complete()
      journal.start(round, 'PATCH')
      const applied = await applyInSnapshot(deps.workspace, diagnosed.plan, diagnosed.payload, deps.boundary)
      journal.complete()
      journal.start(round, 'REGRESSION')
      const after = await deps.regress(round)
      journal.complete()
      const decision = decideIteration(quality, after, diagnosed.plan.targetRegionIds)
      history.push({ round, decision, quality: after.total })
      if (decision === 'revert') {
        await applied.rollback()
      } else {
        quality = after
        acceptedScores.push(after.total)
        const workspaceSnapshotId = await deps.workspace.createSnapshot(`round-${round}`)
        store.add({ id: `round-${round}`, round, quality, workspaceSnapshotId })
        if (decision === 'accept-and-stop') return finish('passed', store, deps, history, journal)
        const stop = shouldStop(acceptedScores, maxRounds)
        if (stop.stop) return finish(stop.reason!, store, deps, history, journal)
      }
      if (round < maxRounds) journal.reset('DIAGNOSE')
    }
    return finish('max-rounds', store, deps, history, journal)
  } catch (error) {
    journal.fail(error)
    const best = store.best()
    if (best) await deps.workspace.restoreSnapshot(best.workspaceSnapshotId)
    history.push({ round: history.length + 1, decision: 'error', error: error instanceof Error ? error.message : String(error) })
    return { reason: 'error', bestRound: best?.round ?? 0, bestSnapshotId: best?.id ?? '', history, journal: journal.entries }
  }
}

async function finish(reason: StopReason, store: SnapshotStore, deps: RefinementDependencies,
  history: RefinementResult['history'], journal: StateJournal): Promise<RefinementResult> {
  const best = store.best()
  if (!best) throw new Error('No stable snapshot exists')
  await deps.workspace.restoreSnapshot(best.workspaceSnapshotId)
  return { reason, bestRound: best.round, bestSnapshotId: best.id, history, journal: journal.entries }
}
