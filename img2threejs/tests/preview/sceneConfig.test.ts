import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLOR, CAMERA_START, ORBIT_LIMITS } from '../../src/preview/sceneConfig';

describe('preview scene defaults', () => {
  it('exports a stable interactive camera setup', () => {
    expect(BACKGROUND_COLOR).toBe(0xd7dde2);
    expect(CAMERA_START).toEqual([7.4, 3.1, 7.8]);
    expect(ORBIT_LIMITS.minDistance).toBe(4.5);
    expect(ORBIT_LIMITS.maxDistance).toBe(16);
  });
});
