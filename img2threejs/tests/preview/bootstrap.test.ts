import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('preview bootstrap lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('returns the createPreviewScene disposer from mountCivicPreview', async () => {
    let createdViewport: HTMLElement | null = null;
    const innerDisposer = vi.fn((viewport: HTMLElement) => {
      viewport.replaceChildren();
    });
    const sceneDisposer = vi.fn(() => {
      if (!createdViewport) {
        throw new Error('Missing created viewport');
      }

      innerDisposer(createdViewport);
    });
    const createPreviewScene = vi.fn((viewport: HTMLElement) => {
      createdViewport = viewport;
      return sceneDisposer;
    });

    vi.doMock('../../src/preview/createPreviewScene', () => ({
      createPreviewScene
    }));

    const { mountCivicPreview } = await import('../../src/preview/mountCivicPreview');
    const host = document.createElement('div');

    const dispose = mountCivicPreview(host);
    const viewport = host.querySelector<HTMLElement>('.viewport');

    expect(viewport).not.toBeNull();
    expect(createPreviewScene).toHaveBeenCalledTimes(1);
    expect(createPreviewScene).toHaveBeenCalledWith(viewport);
    expect(dispose).toBeTypeOf('function');
    expect(sceneDisposer).not.toHaveBeenCalled();
    expect(innerDisposer).not.toHaveBeenCalled();

    dispose();

    expect(sceneDisposer).toHaveBeenCalledTimes(1);
    expect(innerDisposer).toHaveBeenCalledTimes(1);
    expect(innerDisposer).toHaveBeenCalledWith(viewport);
    expect(host.childElementCount).toBe(0);
    expect(host.querySelector('.viewport')).toBeNull();
  });

  it('returns the mount disposer from bootstrapCivicPreview', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const disposer = vi.fn();
    const mountCivicPreview = vi.fn(() => disposer);

    vi.doMock('../../src/preview/mountCivicPreview', () => ({
      mountCivicPreview
    }));

    const { bootstrapCivicPreview } = await import('../../src/main');
    const host = document.querySelector<HTMLElement>('#app');

    expect(host).not.toBeNull();
    expect(mountCivicPreview).toHaveBeenCalledWith(host);
    expect(bootstrapCivicPreview(host)).toBe(disposer);
  });
});
