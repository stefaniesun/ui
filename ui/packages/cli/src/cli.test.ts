import { describe,expect,it } from 'vitest'
import { createCli } from './program.js'
describe('CLI',()=>{it('exposes the complete workflow',()=>{const names=createCli().commands.map(c=>c.name());expect(names).toEqual(['doctor','init','analyze','run','review'])});it('rejects traversal resume ids before touching the model',async()=>{const {runPage}=await import('./commands/run.js');await expect(runPage('fixtures/profile',{maxRounds:1,resume:'../../escape'})).rejects.toThrow(/runId/i)})})
