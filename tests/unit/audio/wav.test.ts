// A5: the WAV encoder, parsed back.
import { describe, expect, it } from 'vitest';
import { encodeWav, parseWavHeader } from '../../../src/audio/wav';

describe('A5 wav', () => {
  it('the header parses back, with the right length', () => {
    const l = new Float32Array(1000);
    const r = new Float32Array(1000);
    const buf = encodeWav(l, r, 48000);
    expect(buf.byteLength).toBe(44 + 1000 * 4);
    expect(parseWavHeader(buf)).toEqual({ channels: 2, sampleRate: 48000, bits: 16, dataBytes: 4000, frames: 1000 });
  });

  it('samples land interleaved and scaled, and out-of-range and NaN are safe', () => {
    const l = Float32Array.from([1, -1, 0, 2, NaN]);
    const r = Float32Array.from([0.5, -0.5, 0, -2, 0]);
    const v = new DataView(encodeWav(l, r, 44100));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(16384);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(-16384);
    expect(v.getInt16(56, true)).toBe(32767);
    expect(v.getInt16(58, true)).toBe(-32768);
    expect(v.getInt16(60, true)).toBe(0);
  });

  it('uses the shorter channel', () => {
    const buf = encodeWav(new Float32Array(10), new Float32Array(4), 48000);
    expect(parseWavHeader(buf)!.frames).toBe(4);
  });

  it('rejects something that is not this format', () => {
    expect(parseWavHeader(new ArrayBuffer(10))).toBeNull();
    const bad = encodeWav(new Float32Array(4), new Float32Array(4), 48000);
    new DataView(bad).setUint8(0, 0);
    expect(parseWavHeader(bad)).toBeNull();
    const truncated = encodeWav(new Float32Array(4), new Float32Array(4), 48000).slice(0, 50);
    expect(parseWavHeader(truncated)).toBeNull();
  });
});
