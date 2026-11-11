import { describe, expect, it } from 'vitest';
import { firstBloomLevels } from '../../../src/testing/devPost';
import { fakeProfile } from '../../../src/testing/scriptedFrame';

describe('firstBloomLevels', () => {
  it('keeps a working count when the first profile has no bloom', () => {
    expect(fakeProfile(0).bloomLevels).toBe(0);
    expect(firstBloomLevels(fakeProfile(0))).toBe(6);
  });

  it("otherwise takes the profile's own count, including ones that differ from the fallback", () => {
    expect(firstBloomLevels(fakeProfile(1))).toBe(3);
    expect(firstBloomLevels(fakeProfile(3))).toBe(6);
    expect(firstBloomLevels(fakeProfile(4))).toBe(7);
  });
});
