import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('bootstrapCivicPreview', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('mounts a viewport through the main entrypoint wiring', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const createPreviewScene = vi.fn();
    vi.doMock('../../src/preview/createPreviewScene', () => ({
      createPreviewScene
    }));

    await import('../../src/main');
    const host = document.querySelector<HTMLElement>('#app');
    const viewport = host?.querySelector<HTMLElement>('.viewport');

    expect(host).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(createPreviewScene).toHaveBeenCalledWith(viewport);
  });
});
