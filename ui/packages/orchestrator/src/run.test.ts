import { describe,expect,it } from 'vitest'
import { decideIteration,shouldStop } from './run.js'
const quality=(total:number)=>({total,regions:[{regionId:'hero',total,critical:true,geometryErrorPx:2,ocrMatch:.99,severeDefects:[]}],code:{types:true,lint:true,componentContract:true}})
describe('iteration decisions',()=>{it('reverts page regression',()=>expect(decideIteration(quality(.86),quality(.82),['hero'])).toBe('revert'));it('stops after two sub-0.5% accepted gains',()=>expect(shouldStop([.86,.863,.866],8)).toEqual({stop:true,reason:'stalled'}));it('passes only all quality gates and target improvement',()=>expect(decideIteration(quality(.87),quality(.89),['hero'])).toBe('accept-and-stop'));it('rejects invalid max rounds',()=>expect(()=>shouldStop([.8],0)).toThrow())})
