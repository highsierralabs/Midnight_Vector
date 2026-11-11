// Optional clip encoding (plan M10): frames piped to the ffmpeg found on PATH, H.264 at CRF 14 in yuv420p.
// ffmpeg is not a project dependency, and Playwright's own ffmpeg-1011 has no rawvideo demuxer (plan section 10), so
// when none is found findFfmpeg returns null and the pack falls back to T10's flipbook. yuv420p softens 1 px neon:
// clips are an archive for the operator, not a judge. The live page is the review.
import { spawn, spawnSync } from 'node:child_process';

/** The first line of `ffmpeg -version`, or null when no ffmpeg runs from PATH. */
export function findFfmpeg(): string | null {
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 20_000 });
    if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.startsWith('ffmpeg version')) return r.stdout.split('\n')[0]!.trim();
  } catch {
    // not found or not runnable: the caller falls back
  }
  return null;
}

export type EncodeInput =
  | { kind: 'raw'; w: number; h: number; fps: number; flipRows?: boolean }   // RGBA, w * h * 4 bytes per frame
  | { kind: 'jpeg'; fps: number };                                             // one complete JPEG per frame

export interface Encoder {
  /** Writes one frame, waiting for the pipe to drain when ffmpeg is behind. */
  write(frame: Uint8Array): Promise<void>;
  /** Closes the input and resolves with ffmpeg's exit code, its stderr and the frames written. */
  close(): Promise<{ code: number; stderr: string; frames: number }>;
}

/** Starts ffmpeg writing `out` (MP4, faststart). Throws if ffmpeg cannot be spawned. */
export function openEncoder(out: string, input: EncodeInput): Encoder {
  const src = input.kind === 'raw'
    ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${input.w}x${input.h}`, '-framerate', String(input.fps), '-i', '-']
    : ['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(input.fps), '-i', '-'];
  const filter = input.kind === 'raw' && input.flipRows ? ['-vf', 'vflip'] : [];
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...src, ...filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d: string) => { stderr += d; });
  const exited = new Promise<number>((done) => {
    proc.on('error', (e) => { stderr += `\nspawn error: ${e.message}`; done(-1); });
    proc.on('close', (code) => done(code ?? -1));
  });
  let frames = 0;
  return {
    async write(frame: Uint8Array): Promise<void> {
      if (input.kind === 'raw' && frame.length !== input.w * input.h * 4) throw new Error(`encode: frame of ${frame.length} bytes for ${input.w}x${input.h}`);
      frames++;
      if (!proc.stdin.write(frame)) await new Promise<void>((r) => proc.stdin.once('drain', () => r()));
    },
    async close(): Promise<{ code: number; stderr: string; frames: number }> {
      proc.stdin.end();
      const code = await exited;
      return { code, stderr: stderr.trim(), frames };
    },
  };
}

/**
 * For frames with irregular timestamps (a CDP screencast): the index of the frame on screen at each tick of a fixed rate,
 * from `start` (default the first frame's time). Before the first frame, frame 0 stands in.
 */
export function resample(times: readonly number[], fps: number, seconds: number, start?: number): number[] {
  const out: number[] = [];
  if (times.length === 0) return out;
  const t0 = start ?? times[0]!;
  let j = 0;
  for (let k = 0; k < Math.round(seconds * fps); k++) {
    const t = t0 + k / fps;
    while (j + 1 < times.length && times[j + 1]! <= t) j++;
    out.push(j);
  }
  return out;
}
