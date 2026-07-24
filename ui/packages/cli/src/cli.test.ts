import { describe,expect,it } from 'vitest'
import { createCli } from './program.js'
describe('CLI',()=>{it('exposes the complete workflow',()=>{const names=createCli().commands.map(c=>c.name());expect(names).toEqual(['doctor','init','analyze','run','review'])})})
