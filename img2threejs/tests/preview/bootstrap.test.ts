import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('bootstrapCivicPreview', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('renders a loading shell through the main entrypoint wiring', async () => {
    document.body.innerHTML = '<div id="app"></div>';

    await import('../../src/main');
    const host = document.querySelector<HTMLElement>('#app');

    expect(host).not.toBeNull();
    expect(host?.textContent).toContain('Loading Civic preview');
  });
});
