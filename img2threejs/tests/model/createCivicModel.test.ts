import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCivicModel } from '../../src/model/createCivicModel';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('createCivicModel', () => {
  it('returns a group with the expected macro component names', () => {
    const model = createCivicModel();

    expect(model).toBeInstanceOf(THREE.Group);
    expect(model.getObjectByName('bodyShell')).toBeTruthy();
    expect(model.getObjectByName('headlightLeft')).toBeTruthy();
    expect(model.getObjectByName('taillightRight')).toBeTruthy();
    expect(model.getObjectByName('wheelFrontLeft')).toBeTruthy();
  });
});
