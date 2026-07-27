import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCivicModel } from '../../src/model/createCivicModel';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('createCivicModel refinements', () => {
  it('adds readable lamp lenses and alloy faces to the blockout', () => {
    const model = createCivicModel();

    expect(model.getObjectByName('headlightLeftLens')).toBeTruthy();
    expect(model.getObjectByName('headlightRightLens')).toBeTruthy();
    expect(model.getObjectByName('taillightLeftLens')).toBeTruthy();
    expect(model.getObjectByName('wheelFrontLeftFace')).toBeTruthy();
    expect(model.getObjectByName('wheelRearRightFace')).toBeTruthy();
  });
});
