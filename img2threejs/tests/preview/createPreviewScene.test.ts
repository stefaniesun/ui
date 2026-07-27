import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  controlsDispose: vi.fn(),
  controlsTargetSet: vi.fn(),
  controlsUpdate: vi.fn(),
  modelFactory: null as null | (() => unknown),
  renderListsDispose: vi.fn(),
  rendererDispose: vi.fn(),
  rendererRender: vi.fn(),
  rendererSetPixelRatio: vi.fn(),
  rendererSetSize: vi.fn()
}));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    renderLists = {
      dispose: mockState.renderListsDispose
    };
    shadowMap = {
      enabled: false
    };

    dispose = mockState.rendererDispose;
    render = mockState.rendererRender;
    setPixelRatio = mockState.rendererSetPixelRatio;
    setSize = mockState.rendererSetSize;
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class MockOrbitControls {
    enableDamping = false;
    maxDistance = 0;
    minDistance = 0;
    target = {
      set: mockState.controlsTargetSet
    };

    dispose = mockState.controlsDispose;
    update = mockState.controlsUpdate;
  }
}));

vi.mock('../../src/model/createCivicModel', () => ({
  createCivicModel: vi.fn(() => {
    if (!mockState.modelFactory) {
      throw new Error('Missing test model factory');
    }

    return mockState.modelFactory();
  })
}));

describe('createPreviewScene lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    mockState.modelFactory = null;
  });

  it('disposes preview resources and clears the host on teardown', async () => {
    const THREE = await import('three');
    const groundGeometryDispose = vi.spyOn(THREE.CircleGeometry.prototype, 'dispose');
    const groundMaterialDispose = vi.spyOn(THREE.ShadowMaterial.prototype, 'dispose');
    const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
    const sharedGeometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const sharedTexture = new THREE.Texture();
    const sharedTextureDispose = vi.spyOn(sharedTexture, 'dispose');
    const sharedMaterial = new THREE.MeshStandardMaterial({
      map: sharedTexture
    });
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, 'dispose');

    mockState.modelFactory = () => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
      group.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
      return group;
    };

    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));

    const { createPreviewScene } = await import('../../src/preview/createPreviewScene');
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = createPreviewScene(host);

    expect(host.querySelector('canvas')).not.toBeNull();

    dispose();
    dispose();

    expect(mockState.controlsDispose).toHaveBeenCalledTimes(1);
    expect(mockState.rendererDispose).toHaveBeenCalledTimes(1);
    expect(mockState.renderListsDispose).toHaveBeenCalledTimes(1);
    expect(groundGeometryDispose).toHaveBeenCalledTimes(1);
    expect(groundMaterialDispose).toHaveBeenCalledTimes(1);
    expect(sharedGeometryDispose).toHaveBeenCalledTimes(1);
    expect(sharedMaterialDispose).toHaveBeenCalledTimes(1);
    expect(sharedTextureDispose).toHaveBeenCalledTimes(1);
    expect(host.childElementCount).toBe(0);
  });
});
