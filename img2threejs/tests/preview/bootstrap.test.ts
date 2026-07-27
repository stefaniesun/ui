import { describe, expect, it } from 'vitest';

describe('bootstrapCivicPreview', () => {
  it('renders a loading shell through the main entrypoint wiring', async () => {
    document.body.innerHTML = '<div id="app"></div>';

    const { bootstrapCivicPreview } = await import('../../src/main');
    const host = document.querySelector<HTMLElement>('#app');

    expect(host).not.toBeNull();

    bootstrapCivicPreview(host!);

    expect(host?.textContent).toContain('Loading Civic preview');
  });
});
