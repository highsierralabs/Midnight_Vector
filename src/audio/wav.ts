// Dev only. 16-bit PCM stereo WAV, for human review from the dev page. No WAV ships.

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer {
  const frames = Math.min(left.length, right.length);
  const data = frames * 4;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const tag = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);            // fmt chunk size
  v.setUint16(20, 1, true);             // PCM
  v.setUint16(22, 2, true);             // channels
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);   // bytes per second
  v.setUint16(32, 4, true);             // block align
  v.setUint16(34, 16, true);            // bits
  tag(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < frames; i++) {
    v.setInt16(44 + i * 4, toPcm(left[i]!), true);
    v.setInt16(46 + i * 4, toPcm(right[i]!), true);
  }
  return buf;
}

function toPcm(x: number): number {
  const c = x !== x ? 0 : x < -1 ? -1 : x > 1 ? 1 : x;
  return Math.round(c < 0 ? c * 32768 : c * 32767);
}

export interface WavInfo { channels: number; sampleRate: number; bits: number; dataBytes: number; frames: number }

/** Parses the 44-byte header this encoder writes. Returns null if it is not one. */
export function parseWavHeader(buf: ArrayBuffer): WavInfo | null {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf);
  const tag = (at: number): string => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null;
  if (v.getUint16(20, true) !== 1) return null;
  const channels = v.getUint16(22, true);
  const bits = v.getUint16(34, true);
  const dataBytes = v.getUint32(40, true);
  if (v.getUint32(4, true) !== 36 + dataBytes || buf.byteLength !== 44 + dataBytes) return null;
  return { channels, sampleRate: v.getUint32(24, true), bits, dataBytes, frames: dataBytes / ((channels * bits) / 8) };
}
