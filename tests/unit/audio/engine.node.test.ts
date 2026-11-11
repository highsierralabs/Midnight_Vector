// A7b: in Node there is no AudioContext. The whole surface must be silent and safe.
import { describe, expect, it } from 'vitest';
import { createAudio } from '../../../src/audio/index';
import { scriptedFrame } from '../../../src/testing/scriptedFrame';

describe('A7b engine in Node', () => {
  it('no AudioContext global exists here, so this test means what it says', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
  });

  it('every method is safe, and unlock resolves', async () => {
    const a = createAudio();
    expect(() => a.setVolume(0.5, 0.5)).not.toThrow();
    expect(() => a.frame(scriptedFrame(1))).not.toThrow();
    expect(() => a.suspend()).not.toThrow();
    expect(() => a.resume()).not.toThrow();
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(() => a.frame(scriptedFrame(2))).not.toThrow();
    expect(() => a.setVolume(NaN, 2)).not.toThrow();
    expect(() => a.dispose()).not.toThrow();
    expect(() => a.frame(scriptedFrame(3))).not.toThrow();
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(() => a.dispose()).not.toThrow();
  });

  it('a second engine is unaffected by the first being disposed', async () => {
    const a = createAudio();
    a.dispose();
    const b = createAudio();
    expect(() => b.frame(scriptedFrame(1))).not.toThrow();
    await expect(b.unlock()).resolves.toBeUndefined();
  });
});
