import type { QualitySnapshot } from './gates.js'
export interface StableSnapshot { id: string; round: number; quality: QualitySnapshot }
export class SnapshotStore {
  private snapshots: StableSnapshot[] = []
  add(snapshot: StableSnapshot): void { this.snapshots.push(structuredClone(snapshot)) }
  best(): StableSnapshot | null { return this.snapshots.reduce<StableSnapshot|null>((best,current)=>!best||current.quality.total>best.quality.total?current:best,null) }
  all(): readonly StableSnapshot[] { return this.snapshots }
}
