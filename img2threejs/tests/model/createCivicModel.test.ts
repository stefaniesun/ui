import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCivicModel } from '../../src/model/createCivicModel';
import * as civicBlockout from '../../src/generated/civic-blockout';

const generatedBlockoutPath = resolve(process.cwd(), 'src/generated/civic-blockout.ts');
const forbiddenArtifactMarkers = [
  'LookDevLights',
  'PresentationComposer',
  'InspectControls',
  'RoomEnvironment',
  'EffectComposer',
  'RenderPass',
  'BokehPass',
  'UnrealBloomPass',
  'OrbitControls',
  'lookDevTargets'
];

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('createCivicModel', () => {
  it('does not leave look-dev or presentation markers in the generated blockout artifact', () => {
    const generatedBlockout = readFileSync(generatedBlockoutPath, 'utf8');

    for (const marker of forbiddenArtifactMarkers) {
      expect(generatedBlockout).not.toContain(marker);
    }
  });

  it('does not expose later-scope look-dev helpers from the blockout module', () => {
    expect('create20162021HondaCivicSedanLookDevLights' in civicBlockout).toBe(false);
    expect('create20162021HondaCivicSedanEnvironment' in civicBlockout).toBe(false);
    expect('frame20162021HondaCivicSedanCamera' in civicBlockout).toBe(false);
    expect('create20162021HondaCivicSedanPresentationComposer' in civicBlockout).toBe(false);
    expect('configure20162021HondaCivicSedanRenderer' in civicBlockout).toBe(false);
    expect('create20162021HondaCivicSedanInspectControls' in civicBlockout).toBe(false);
  });

  it('returns a group with the expected macro component names', () => {
    const model = createCivicModel();

    expect(model).toBeInstanceOf(THREE.Group);
    expect(model.getObjectByName('bodyShell')).toBeTruthy();
    expect(model.getObjectByName('headlightLeft')).toBeTruthy();
    expect(model.getObjectByName('taillightRight')).toBeTruthy();
    expect(model.getObjectByName('wheelFrontLeft')).toBeTruthy();
  });
});
