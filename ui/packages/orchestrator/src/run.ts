import { evaluateGates } from './gates.js'
import type { QualitySnapshot } from './gates.js'
export type StopReason='passed'|'stalled'|'max-rounds'
export function shouldStop(scores: readonly number[], maxRounds: number): { stop:boolean; reason?:StopReason } {
  if (scores.length >= maxRounds) return { stop:true, reason:'max-rounds' }
  if (scores.length >= 3) {
    const first=scores.at(-3)!,second=scores.at(-2)!,third=scores.at(-1)!
    if (second-first < 0.005 && third-second < 0.005) return { stop:true, reason:'stalled' }
  }
  return { stop:false }
}
export function decideIteration(before:QualitySnapshot,after:QualitySnapshot): {decision:'revert'|'accept-and-continue'|'accept-and-stop';stableSnapshotId:string} {
  if (after.total < before.total) return {decision:'revert',stableSnapshotId:'round-0'}
  return {decision:evaluateGates(after).passed?'accept-and-stop':'accept-and-continue',stableSnapshotId:'round-1'}
}
