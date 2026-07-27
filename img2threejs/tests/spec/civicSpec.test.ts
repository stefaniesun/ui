import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const specPath = resolve(process.cwd(), 'civvi/analysis/stage2-object-sculpt-spec.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

describe('Civic sculpt spec', () => {
  it('classifies the object and defines the macro car parts', () => {
    expect(spec.preSpecAssessment.objectClass.primaryType).toBe('sedan-car');

    const ids = new Set(spec.componentTree.map((component: { id: string }) => component.id));
    expect(ids.has('bodyShell')).toBe(true);
    expect(ids.has('frontBumper')).toBe(true);
    expect(ids.has('rearBumper')).toBe(true);
    expect(ids.has('headlightLeft')).toBe(true);
    expect(ids.has('headlightRight')).toBe(true);
    expect(ids.has('wheelFrontLeft')).toBe(true);
    expect(ids.has('wheelFrontRight')).toBe(true);
    expect(ids.has('wheelRearLeft')).toBe(true);
    expect(ids.has('wheelRearRight')).toBe(true);
  });

  it('defines the Civic material families', () => {
    const materialIds = new Set(spec.materials.map((material: { id: string }) => material.id));
    expect(materialIds.has('bodyPaint')).toBe(true);
    expect(materialIds.has('glassTint')).toBe(true);
    expect(materialIds.has('blackTrim')).toBe(true);
    expect(materialIds.has('alloyWheel')).toBe(true);
    expect(materialIds.has('tireRubber')).toBe(true);
    expect(materialIds.has('lampLens')).toBe(true);
  });
});
