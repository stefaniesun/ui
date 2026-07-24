import { describe,expect,it } from 'vitest'
import { validatePatchPayload } from './patch-runner.js'

const plan={targetRegionIds:['hero'],rootCause:'spacing',allowedFiles:['src/Hero.vue'],allowedComponents:['Hero'],allowedTokens:[],expectedMetricChanges:{total:.01},affectedStateIds:['default'],affectedTargets:['h5' as const],rollbackConditions:['regression']}
describe('patch whitelist',()=>{it('rejects files outside the PatchPlan',()=>{expect(()=>validatePatchPayload(plan,{'src/Other.vue':'x'})).toThrow(/not allowed/i)});it('accepts complete replacement for an allowed file',()=>{expect(validatePatchPayload(plan,{'src/Hero.vue':'<template />'})).toEqual(['src/Hero.vue'])})})
