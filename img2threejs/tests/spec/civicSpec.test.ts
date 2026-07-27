import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LocalFeature = { id: string } | string;

type SculptComponent = {
  id: string;
  level?: string;
  localFeatures?: LocalFeature[];
};

const specPath = resolve(process.cwd(), 'civvi/analysis/stage2-object-sculpt-spec.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const validatorPath = resolve(process.cwd(), 'scripts/validate-civic-spec.ps1');
const validatorScript = readFileSync(validatorPath, 'utf8');

describe('Civic sculpt spec', () => {
  const componentById = new Map<string, SculptComponent>(
    spec.componentTree.map((component: SculptComponent) => [component.id, component]),
  );

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

  it('includes implementation-meaningful meso structure', () => {
    const ids = new Set(
      spec.componentTree
        .filter((component: { level: string }) => component.level === 'meso')
        .map((component: { id: string }) => component.id),
    );

    expect(ids.has('frontGrille')).toBe(true);
    expect(ids.has('lowerIntake')).toBe(true);
    expect(ids.has('rockerLeft')).toBe(true);
    expect(ids.has('rockerRight')).toBe(true);
    expect(ids.has('rearLowerInsert')).toBe(true);
    expect(ids.has('licenseRecess')).toBe(true);
    expect(ids.has('windowBeltlineLeft')).toBe(true);
    expect(ids.has('fuelDoor')).toBe(true);
  });

  it('does not pre-record tier 1 blockout review evidence', () => {
    expect(spec.tier1Results ?? []).toEqual([]);
  });

  it('maps detail inventory items to real local features with valid kinds', () => {
    const validKinds = new Set([
      'gloss', 'bevel', 'fastener', 'linework', 'contour', 'seam', 'stitch',
      'stain', 'scratch', 'chip', 'decal', 'emissive', 'hole', 'groove', 'ridge',
    ]);

    for (const detail of spec.preSpecAssessment.detailInventory.details) {
      expect(validKinds.has(detail.kind)).toBe(true);
      expect(typeof detail.mapsTo?.ref).toBe('string');

      const [componentId, featureId] = String(detail.mapsTo.ref).split('/');
      const component = componentById.get(componentId);
      expect(component).toBeTruthy();
      if (!component) {
        throw new Error(`Missing component ${componentId} for detail mapping assertion.`);
      }

      const featureIds = new Set((component.localFeatures ?? []).map((feature: LocalFeature) =>
        typeof feature === 'string' ? feature : feature.id,
      ));
      expect(featureIds.has(featureId)).toBe(true);
    }
  });

  it('stops immediately when sculpt spec validation exits nonzero', () => {
    expect(validatorScript).toContain("if ($LASTEXITCODE -ne 0) {\n  throw 'Sculpt spec validation failed.'\n}");
  });

  it('resolves forge tools from environment-aware paths instead of a hard-coded user path', () => {
    expect(validatorScript).toContain('IMG2THREEJS_FORGE_ROOT');
    expect(validatorScript).toContain('CODEX_HOME');
    expect(validatorScript).not.toContain('C:\\Users\\stefanie\\.codex\\skills\\img2threejs\\forge');
  });
});
