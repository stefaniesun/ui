import { describe,expect,it } from 'vitest'
import { decideIteration,shouldStop } from './run.js'

const quality=(total:number)=>({total,regions:[{regionId:'hero',total,critical:true,geometryErrorPx:2,ocrMatch:.99,severeDefects:[]}],codeHealthy:true})
describe('iteration decisions',()=>{it('reverts page regression',()=>{expect(decideIteration(quality(.86),quality(.82))).toEqual({decision:'revert',stableSnapshotId:'round-0'})});it('stops after two sub-0.5% gains',()=>{expect(shouldStop([.86,.863,.866],8)).toEqual({stop:true,reason:'stalled'})});it('passes only all quality gates',()=>{expect(decideIteration(quality(.87),quality(.89)).decision).toBe('accept-and-stop')})})
