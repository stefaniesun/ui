import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCivicModel } from '../../src/model/createCivicModel';
import { refineCivicModel } from '../../src/model/refineCivicModel';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const requiredRefinements = [
  ['headlightLeftLens', 'headlightLeft'],
  ['headlightRightLens', 'headlightRight'],
  ['taillightLeftLens', 'taillightLeft'],
  ['taillightRightLens', 'taillightRight'],
  ['wheelFrontLeftFace', 'wheelFrontLeft'],
  ['wheelFrontRightFace', 'wheelFrontRight'],
  ['wheelRearLeftFace', 'wheelRearLeft'],
  ['wheelRearRightFace', 'wheelRearRight']
] as const;

describe('createCivicModel refinements', () => {
  it('adds all refinement meshes under the expected parent nodes', () => {
    const model = createCivicModel();

    for (const [childName, parentName] of requiredRefinements) {
      const child = model.getObjectByName(childName);
      const parent = model.getObjectByName(parentName);

      expect(child, childName).toBeTruthy();
      expect(parent, parentName).toBeTruthy();
      expect(child?.parent).toBe(parent);
    }
  });

  it('keeps exactly one refinement mesh per required name when applied twice', () => {
    const model = createCivicModel();

    refineCivicModel(model);

    for (const [childName] of requiredRefinements) {
      const matches = model.getObjectsByProperty('name', childName);
      expect(matches, childName).toHaveLength(1);
    }
  });

  it('places wheel faces along the wheel local sidewall axis', () => {
    const model = createCivicModel();

    for (const [childName, parentName] of requiredRefinements) {
      if (!parentName.startsWith('wheel')) {
        continue;
      }

      const parent = model.getObjectByName(parentName);
      const child = model.getObjectByName(childName);
      const wheelPosition = parent?.userData.sculptComponent?.transform?.position as
        | [number, number, number]
        | undefined;

      expect(parent, parentName).toBeTruthy();
      expect(child, childName).toBeTruthy();
      expect(child?.position.x).toBe(0);
      expect(child?.position.z).toBe(0);
      expect(Math.abs(child?.position.y ?? 0)).toBeGreaterThan(0);
      expect(Math.sign(child?.position.y ?? 0)).toBe(Math.sign(wheelPosition?.[2] ?? 0));
    }
  });
});
