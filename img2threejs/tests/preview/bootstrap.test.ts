import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('preview bootstrap lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('returns the createPreviewScene disposer from mountCivicPreview', async () => {
    const innerDisposer = vi.fn((viewport: HTMLElement) => {
      viewport.replaceChildren();
    });
    const createPreviewScene = vi.fn((viewport: HTMLElement) => () => {
      innerDisposer(viewport);
    });

    vi.doMock('../../src/preview/createPreviewScene', () => ({
      createPreviewScene
    }));

    const { mountCivicPreview } = await import('../../src/preview/mountCivicPreview');
    const host = document.createElement('div');

    const dispose = mountCivicPreview(host);
    const viewport = host.querySelector<HTMLElement>('.viewport');

    expect(viewport).not.toBeNull();
    expect(createPreviewScene).toHaveBeenCalledWith(viewport);
    expect(dispose).toBeTypeOf('function');
    expect(innerDisposer).not.toHaveBeenCalled();

    dispose();

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
