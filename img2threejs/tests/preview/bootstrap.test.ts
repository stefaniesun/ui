import { describe, expect, it } from 'vitest';
import { mountCivicPreview } from '../../src/preview/mountCivicPreview';

describe('mountCivicPreview', () => {
  it('renders a loading shell into the host container', () => {
    const host = document.createElement('div');

    mountCivicPreview(host);

    expect(host.textContent).toContain('Loading Civic preview');
  });
});
