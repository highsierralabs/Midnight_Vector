// Every browser gate of T07, named by prefix in plan section 7. All in one spec under gpu, with no .timing file:
// audio needs neither timing flags nor vsync-free rendering. Numbers around these thresholds are [A]. They catch
// mistakes and regressions, and they do not establish that it sounds good.
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Ev, SimMode } from '../../src/contracts/index';
import {
  Layer, SOURCES_PER_NOTE, createBarPattern, resumeSources, worstResume, type SectorMusic,
} from '../../src/audio/composer';
import { MAX_LIVE_SOURCES } from '../../src/audio/mix';
import type { SceneEvent, SceneOptions } from '../../src/audio/offline';
import { parseWavHeader } from '../../src/audio/wav';
import type { TraceEntry } from '../../src/audio/devPage';   // also brings window.__audio into the program
import { expect, saveShot, test } from '../support/pw';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright/test';

test.setTimeout(180_000);

const PAGE = '/dev/audio.html';
const START = { x: 136, y: 48 };
const DRUMS = [Layer.KICK, Layer.SNARE, Layer.HAT, Layer.OHAT, Layer.TOM, Layer.CRASH, Layer.RISER];

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`${PAGE}${query}`);
}

/** The recorder of A19. Installed before any page script, and it adds no evaluate. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec = {
      log: [] as { what: string; t: number }[],
      contexts: [] as AudioContext[],
      offline: 0,
      starts: 0,
      clicks: 0,
    };
    (window as unknown as { __rec: typeof rec }).__rec = rec;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        super(o);
        rec.contexts.push(this);
        rec.log.push({ what: 'AudioContext', t: performance.now() });
      }
    };
    const RealOffline = window.OfflineAudioContext;
    window.OfflineAudioContext = class extends RealOffline {
      constructor(...args: [number, number, number]) {
        super(...args);
        rec.offline += 1;
        rec.log.push({ what: 'OfflineAudioContext', t: performance.now() });
      }
    } as typeof OfflineAudioContext;
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function patched(this: AudioScheduledSourceNode, when?: number) {
      rec.starts += 1;
      rec.log.push({ what: 'start', t: performance.now() });
      return start.call(this, when);
    };
    // AudioBufferSourceNode declares its own start(when, offset, duration), which the patch above does not reach: an
    // earlier recorder missed every kit one-shot and noise burst (T07 repair R1, Surprises).
    if (Object.prototype.hasOwnProperty.call(AudioBufferSourceNode.prototype, 'start')) {
      const bufferStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function patchedBuffer(this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
        rec.starts += 1;
        rec.log.push({ what: 'start', t: performance.now() });
        return bufferStart.apply(this, args);
      };
    }
    document.addEventListener('click', () => {
      rec.clicks += 1;
      rec.log.push({ what: 'click', t: performance.now() });
    }, true);
  });
}

interface RecSummary { contexts: number; states: string[]; offline: number; starts: number; clicks: number; firstClick: number; before: string[]; eager: string | null }

async function readRecorder(page: Page): Promise<RecSummary> {
  return page.evaluate(() => {
    const rec = (window as unknown as { __rec: { log: { what: string; t: number }[]; contexts: AudioContext[]; offline: number; starts: number; clicks: number } }).__rec;
    const first = rec.log.find((e) => e.what === 'click');
    const firstClick = first ? first.t : Infinity;
    return {
      contexts: rec.contexts.length,
      states: rec.contexts.map((c) => c.state),
      offline: rec.offline,
      starts: rec.starts,
      clicks: rec.clicks,
      firstClick,
      before: rec.log.filter((e) => e.what !== 'click' && e.t < firstClick).map((e) => e.what),
      eager: window.__eagerCtx ? window.__eagerCtx.state : null,
    };
  });
}

/** Autoplay policy held: nothing audio exists before the first real click, and exactly one context after it. */
function violations(r: RecSummary): string[] {
  const out: string[] = [];
  if (r.before.length > 0) out.push(`before the click: ${r.before.join(', ')}`);
  if (r.contexts !== 1) out.push(`${r.contexts} AudioContexts`);
  if (r.states[0] !== 'running') out.push(`state ${r.states[0] ?? 'none'}`);
  return out;
}

/** Waits for the kit and the first anchor, by polling in the page. Only for use after the real gesture. */
async function waitLive(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__audio!.live.stats();
    return s.running && s.scheduled > 0;
  });
}

async function unlockLive(page: Page, o: { sync?: number } = {}): Promise<void> {
  await open(page);
  await page.mouse.click(START.x, START.y);
  await page.evaluate((sync) => window.__audio!.live.set({ sync }), o.sync ?? 16);
  await waitLive(page);
}

async function sleep(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

// ---- A8 ----

test('kit: snare has a gated shape, and every buffer is finite, peak 1, nonzero', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const a = A.a;
    const k = await A.kit();
    const open_ = await A.kit({ gateOff: true });
    const shape = (b: AudioBuffer): { early: number; plateau: number; after: number } => {
      const x = b.getChannelData(0);
      const sr = b.sampleRate;
      return { early: a.segDb(x, sr, 0.01, 0.03), plateau: a.segDb(x, sr, 0.17, 0.195), after: a.segDb(x, sr, 0.24, 0.26) };
    };
    const sounds = ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'riser'] as const;
    const buffers = sounds.map((n) => {
      const b = k[n];
      let pk = 0;
      let bad = 0;
      let e = 0;
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        pk = Math.max(pk, a.peak(d));
        bad += a.badCount(d);
        for (let i = 0; i < d.length; i++) e += d[i]! * d[i]!;
      }
      return { n, pk, bad, e, channels: b.numberOfChannels, seconds: b.duration };
    });
    return { gated: shape(k.snare), open: shape(open_.snare), buffers };
  });
  console.log(`A8 ${JSON.stringify(r.gated)} open ${JSON.stringify(r.open)}`);
  const plateauDrop = r.gated.early - r.gated.plateau;
  const cut = r.gated.plateau - r.gated.after;
  const openCut = r.open.plateau - r.open.after;
  console.log(`A8 plateau within ${plateauDrop.toFixed(1)} dB of the hit (limit 12), cut ${cut.toFixed(1)} dB (at least 30); control gateOff cut ${openCut.toFixed(1)} dB (under 15)`);
  expect(plateauDrop).toBeLessThanOrEqual(12);
  expect(cut).toBeGreaterThanOrEqual(30);
  expect(openCut).toBeLessThan(15);
  for (const b of r.buffers) {
    expect(b.bad, b.n).toBe(0);
    expect(b.pk, b.n).toBeCloseTo(1, 4);
    expect(b.e, b.n).toBeGreaterThan(0);
  }
});

test('kit: ready within 1 s of unlock', async ({ page }) => {
  await open(page);
  const t0 = Date.now();
  await page.mouse.click(START.x, START.y);
  await page.waitForFunction(() => window.__audio!.live.probe().kit !== null);
  const ms = Date.now() - t0;
  console.log(`A8 kit ready ${ms} ms after the click, Playwright round trips included`);
  expect(ms).toBeLessThanOrEqual(1000);
});

// ---- A9 ----

const LEVEL_PEAK = 0.985;

test('levels: full mix at SYNC 1, SYNC 16, and 44100 Hz', async ({ page }) => {
  await open(page);
  const rows = await page.evaluate(async () => {
    const A = window.__audio!;
    const base = { bar0: 0, bars: 16, sector: 0, key: 0, volume: [1, 1] as [number, number] };
    return {
      sync1: await A.scene({ ...base, sync: 1 }),
      sync16: await A.scene({ ...base, sync: 16 }),
      hz44: await A.scene({ ...base, sync: 16, sampleRate: 44100 }),
    };
  });
  for (const [name, m] of Object.entries(rows)) {
    console.log(`A9 ${name}: peak ${m.peak.toFixed(3)}, RMS ${m.rmsDb.toFixed(2)} dBFS, clip ${m.clip}, bad ${m.bad}, dc ${m.dc.toExponential(1)}, crest ${m.crestDb.toFixed(1)}`);
    expect(m.peak, name).toBeLessThanOrEqual(LEVEL_PEAK);
    expect(m.rmsDb, name).toBeGreaterThanOrEqual(-19);
    expect(m.rmsDb, name).toBeLessThanOrEqual(-12);
    expect(m.clip, name).toBe(0);
    expect(m.bad, name).toBe(0);
    expect(Math.abs(m.dc), name).toBeLessThanOrEqual(0.001);
  }
});

test('levels: matrix of 6 sectors x keys 0, 6, 7 at SYNC 16, bars 16 to 23', async ({ page }) => {
  test.setTimeout(600_000);
  await open(page);
  const rows = await page.evaluate(async () => {
    const A = window.__audio!;
    const out: { sector: number; key: number; peak: number; rms: number; high: number; clip: number }[] = [];
    for (let sector = 0; sector < 6; sector++) {
      for (const key of [0, 6, 7]) {
        const m = await A.scene({ bar0: 16, bars: 8, sync: 16, sector, key });
        out.push({ sector, key, peak: m.peak, rms: m.rmsDb, high: m.bands[3], clip: m.clip });
      }
    }
    return out;
  });
  const peaks = rows.map((r) => r.peak);
  const rms = rows.map((r) => r.rms);
  console.log(`A9b ${rows.length} cases: peak ${Math.min(...peaks).toFixed(3)} to ${Math.max(...peaks).toFixed(3)}, RMS ${Math.min(...rms).toFixed(2)} to ${Math.max(...rms).toFixed(2)}, high band ${Math.min(...rows.map((r) => r.high)).toFixed(1)} to ${Math.max(...rows.map((r) => r.high)).toFixed(1)}`);
  expect(rows).toHaveLength(18);
  for (const r of rows) {
    expect(r.peak, `sector ${r.sector} key ${r.key}`).toBeLessThanOrEqual(LEVEL_PEAK);
    expect(r.rms, `sector ${r.sector} key ${r.key}`).toBeGreaterThanOrEqual(-19);
    expect(r.rms, `sector ${r.sector} key ${r.key}`).toBeLessThanOrEqual(-12);
    expect(r.clip).toBe(0);
  }
});

test('levels: a storm of 64 blips stays bounded, with both controls', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const events: SceneEvent[] = [];
    for (let i = 0; i < 64; i++) events.push({ bar: Math.floor(i / 16), step: i % 16, afterS: 0.04, kind: A.Ev.SHARD, x: 20, value: 100 });
    const scene: SceneOptions = { bar0: 16, bars: 4, sync: 16, sector: 0, key: 0, events };
    return {
      storm: await A.scene(scene),
      boosted: await A.scene({ ...scene, faults: { boostDb: 12 } }),
      unbounded: await A.scene({ ...scene, faults: { boostDb: 12, noSoftClip: true } }),
    };
  });
  console.log(`A9c storm peak ${r.storm.peak.toFixed(3)} clip ${r.storm.clip}; +12 dB peak ${r.boosted.peak.toFixed(3)} clip ${r.boosted.clip}; +12 dB with no soft clip peak ${r.unbounded.peak.toFixed(3)} clip ${r.unbounded.clip}`);
  expect(r.storm.peak).toBeLessThanOrEqual(LEVEL_PEAK);
  expect(r.storm.clip).toBe(0);
  expect(r.boosted.peak).toBeLessThanOrEqual(LEVEL_PEAK);
  expect(r.unbounded.clip).toBeGreaterThan(0);
});

// ---- A10 ----

test('balance: band shares, width, and mono bass', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (layers) => {
    const A = window.__audio!;
    const base = { bar0: 0, bars: 16, sector: 0, key: 0 };
    return {
      s1: await A.scene({ ...base, sync: 1 }),
      s16: await A.scene({ ...base, sync: 16 }),
      bass: await A.scene({ ...base, sync: 16, layers: [layers.bass] }),
      pad: await A.scene({ ...base, sync: 16, layers: [layers.pad] }),
    };
  }, { bass: Layer.BASS, pad: Layer.PAD });
  const fmt = (b: readonly number[]): string => b.map((x) => x.toFixed(1)).join(', ');
  console.log(`A10 SYNC 1 bands ${fmt(r.s1.bands)}, corr ${r.s1.corr.toFixed(2)}, mono ${r.s1.monoDb.toFixed(2)}`);
  console.log(`A10 SYNC 16 bands ${fmt(r.s16.bands)}, corr ${r.s16.corr.toFixed(2)}, mono ${r.s16.monoDb.toFixed(2)}`);
  console.log(`A10 bass solo corr ${r.bass.corr.toFixed(3)}; pad solo corr ${r.pad.corr.toFixed(3)}`);
  for (const m of [r.s1, r.s16]) {
    expect(m.bands[0]).toBeGreaterThanOrEqual(-4);
    expect(m.bands[0]).toBeLessThanOrEqual(-0.3);
    expect(m.bands[1]).toBeGreaterThanOrEqual(-10);
    expect(m.bands[1]).toBeLessThanOrEqual(-3);
    expect(m.bands[2]).toBeGreaterThanOrEqual(-25);
    expect(m.bands[2]).toBeLessThanOrEqual(-10);
    expect(m.bands[3]).toBeGreaterThanOrEqual(-28);
    expect(m.bands[3]).toBeLessThanOrEqual(-18);
    expect(m.corr).toBeGreaterThanOrEqual(0.4);
    expect(m.corr).toBeLessThanOrEqual(0.95);
    expect(m.monoDb).toBeGreaterThanOrEqual(-1.5);
  }
  expect(r.s16.bands[2] - r.s1.bands[2]).toBeGreaterThanOrEqual(3);
  expect(r.bass.corr).toBeGreaterThanOrEqual(0.99);
  expect(r.pad.corr).toBeLessThanOrEqual(0.5);
});

// ---- A11 ----

test('solo: each layer group at its level, muted layers silent, and SYNC gates audible', async ({ page }) => {
  await open(page);
  const groups = { drums: DRUMS, bass: [Layer.BASS], pad: [Layer.PAD], arp: [Layer.ARP], lead: [Layer.LEAD] };
  const r = await page.evaluate(async (g) => {
    const A = window.__audio!;
    const base = { bar0: 16, bars: 8, sync: 16, sector: 0, key: 0 };
    const solos: Record<string, number> = {};
    for (const [name, layers] of Object.entries(g)) solos[name] = (await A.scene({ ...base, layers })).rmsDb;
    const gate = async (layer: number, sync: number): Promise<number> => (await A.scene({ bar0: 0, bars: 4, sector: 0, key: 0, sync, layers: [layer] })).rmsDb;
    return {
      solos,
      muted: (await A.scene({ ...base, layers: g.arp, faults: { muteLayer: g.arp[0]! } })).rmsDb,
      arp3: await gate(g.arp[0]!, 3), arp4: await gate(g.arp[0]!, 4),
      lead7: await gate(g.lead[0]!, 7), lead8: await gate(g.lead[0]!, 8),
    };
  }, groups);
  console.log(`A11 ${JSON.stringify(Object.fromEntries(Object.entries(r.solos).map(([k, v]) => [k, +v.toFixed(1)])))}; muted ${r.muted.toFixed(0)}; arp ${r.arp3.toFixed(0)} then ${r.arp4.toFixed(1)}; lead ${r.lead7.toFixed(0)} then ${r.lead8.toFixed(1)}`);
  const want: Record<string, number> = { drums: -18.1, bass: -18.8, pad: -21.2, arp: -24.7, lead: -23.1 };
  for (const [name, level] of Object.entries(want)) {
    expect(Math.abs(r.solos[name]! - level), name).toBeLessThanOrEqual(4);
  }
  expect(r.muted).toBeLessThan(-90);
  expect(r.arp3).toBeLessThan(-90);
  expect(r.arp4).toBeGreaterThanOrEqual(-30);
  expect(r.lead7).toBeLessThan(-90);
  expect(r.lead8).toBeGreaterThanOrEqual(-30);
});

// ---- A12 ----

test('pitch: the render carries the composer notes and key', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (l) => {
    const A = window.__audio!;
    const a = A.a;
    const out: { key: number; margins: number[]; chroma: number[]; wrongMargins: number[]; wrongChroma: number[] }[] = [];
    for (const key of [0, 1, 5, 10]) {
      const measure = async (faults: { transpose?: number }): Promise<{ margins: number[]; chroma: number[] }> => {
        const bass = await A.render({ bar0: 0, bars: 4, sync: 1, sector: 0, key, layers: [l.bass], tailS: 0.3, faults });
        const pad = await A.render({ bar0: 0, bars: 4, sync: 1, sector: 0, key, layers: [l.pad], tailS: 0.3, faults });
        const margins: number[] = [];
        const chroma: number[] = [];
        for (let i = 0; i < 4; i++) {
          const t0 = A.startS + i * A.barS;
          margins.push(a.bassMarginDb(bass.buffer.getChannelData(0), 48000, t0 + 0.02, t0 + 2.32, A.firstBass(i, 0, key, 1)));
          chroma.push(a.chromaInChord(pad.buffer.getChannelData(0), 48000, t0 + 0.9, A.padPcs(i, 0, key, 1)));
        }
        return { margins, chroma };
      };
      const right = await measure({});
      const wrong = await measure({ transpose: 1 });
      out.push({ key, margins: right.margins, chroma: right.chroma, wrongMargins: wrong.margins, wrongChroma: wrong.chroma });
    }
    return out;
  }, { bass: Layer.BASS, pad: Layer.PAD });
  for (const k of r) {
    const f = (x: number[]): string => x.map((v) => v.toFixed(2)).join(' ');
    console.log(`A12 key ${k.key}: margin ${f(k.margins)}; chroma ${f(k.chroma)}; transposed margin ${f(k.wrongMargins)}; chroma ${f(k.wrongChroma)}`);
    for (const m of k.margins) expect(m).toBeGreaterThanOrEqual(3);
    for (const c of k.chroma) expect(c).toBeGreaterThanOrEqual(0.85);
    for (const m of k.wrongMargins) expect(m).toBeLessThanOrEqual(-5);
    for (const c of k.wrongChroma) expect(c).toBeLessThanOrEqual(0.5);
  }
});

// ---- A13 ----

test('pump: the pad dips at each kick, and the reverb tail is there', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (pad) => {
    const A = window.__audio!;
    const a = A.a;
    const render = async (faults: { noPump?: boolean; pumpFloor?: number }): Promise<AudioBuffer> =>
      (await A.render({ bar0: 0, bars: 2, sync: 4, sector: 0, key: 0, layers: [pad], tailS: 0.3, faults })).buffer;
    // RMS before a kick minus RMS just after, over both channels.
    const raw = (b: AudioBuffer): number[] => {
      const L = b.getChannelData(0);
      const R = b.getChannelData(1);
      const seg = (t0: number, t1: number): number =>
        10 * Math.log10((Math.pow(10, a.segDb(L, 48000, t0, t1) / 10) + Math.pow(10, a.segDb(R, 48000, t0, t1) / 10)) / 2);
      return [4, 8, 12].map((st) => {
        const t = A.startS + st * A.stepS;
        // The kick's dip reaches the output about 8 ms late (A14), and half the pad is 13 to 19 ms later again through
        // the chorus, so "just after" starts at +25 ms, once the 17 ms drop has landed in both paths.
        return seg(t - 0.08, t - 0.01) - seg(t + 0.025, t + 0.075);
      });
    };
    const pumped = raw(await render({}));
    const flat = raw(await render({ noPump: true }));
    // The negative control: a pump that falls only to .85, not .55. It must read under the 2.5 dB limit.
    const shallow = raw(await render({ pumpFloor: 0.85 }));
    const tail = async (noReverb: boolean): Promise<number> => {
      const m = await A.render({ bar0: 16, bars: 1, sync: 8, sector: 0, key: 0, layers: [pad], tailS: 2.5, faults: { noReverb } });
      return a.segDb(m.buffer.getChannelData(0), 48000, 3.4, 3.6);
    };
    return { pumped, flat, shallow, tail: await tail(false), dry: await tail(true) };
  }, Layer.PAD);
  // Detuned saws beat, so one render moves up to 3 dB across 50 ms with no pump at all (Decision log). The two renders
  // are the same sound to within 1e-4, so subtracting the same reading without the pump leaves the envelope alone.
  const dip = r.pumped.map((v, i) => v - r.flat[i]!);
  const control = r.shallow.map((v, i) => v - r.flat[i]!);
  console.log(`A13 dip ${dip.map((v) => v.toFixed(2))}; control pumpFloor .85 ${control.map((v) => v.toFixed(2))}; single-render reading ${r.pumped.map((v) => v.toFixed(1))}, and with no pump ${r.flat.map((v) => v.toFixed(1))}; tail ${r.tail.toFixed(1)} dB; noReverb ${r.dry.toFixed(1)} dB`);
  for (const d of dip) expect(d).toBeGreaterThanOrEqual(2.5);
  // The same 2.5 dB gate rejects a shallow pump at every kick, so the referenced reading can fail (V1 ruling).
  for (const d of control) expect(d).toBeLessThan(2.5);
  expect(r.tail).toBeGreaterThanOrEqual(-60);
  expect(r.tail).toBeLessThanOrEqual(-30);
  expect(r.dry).toBeLessThan(-90);
});

// ---- A14 ----

test('onsets: kick only, on the grid, and a 20 ms offset fails', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (kick) => {
    const A = window.__audio!;
    const a = A.a;
    const read = async (stepOffsetMs: number): Promise<number[]> => {
      const m = await A.render({ bar0: 0, bars: 2, sync: 4, sector: 0, key: 0, layers: [kick], tailS: 0.4, faults: { stepOffsetMs } });
      // A 2 ms envelope follows single cycles of a 50 Hz kick, so it needs a gap to count each kick once.
      return a.onsets(m.buffer.getChannelData(0), 48000, 200, 0.002, 0.3, 0.3).map((t) => t - A.startS);
    };
    return { onTime: await read(0), shifted: await read(20), stepS: A.stepS };
  }, Layer.KICK);
  // The constant lag is a literal, from plan A14 [O]: subtracting a value measured from the same render would remove
  // the very offset the control applies. 2 ms of hop, and the chain's own delay ahead of the destination.
  const LAG = 0.008;
  console.log(`A14 raw onsets ${r.onTime.map((t) => t.toFixed(3))}`);
  expect(r.onTime).toHaveLength(8);
  const errors = r.onTime.map((t, i) => Math.abs(t - LAG - i * 4 * r.stepS));
  const shifted = r.shifted.map((t, i) => Math.abs(t - LAG - i * 4 * r.stepS));
  console.log(`A14 worst error ${(Math.max(...errors) * 1e3).toFixed(2)} ms; with the 20 ms offset ${(Math.max(...shifted) * 1e3).toFixed(2)} ms`);
  for (const e of errors) expect(e).toBeLessThanOrEqual(0.003);
  expect(Math.max(...shifted)).toBeGreaterThan(0.003);
});

// ---- A15 ----

test('duck: -9 dB through 500 Hz for 400 ms, with no click, and modes muffle', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const a = A.a;
    const hitT = A.startS + 4 * A.barS + 1.0;
    const hit: SceneEvent = { bar: 4, step: 6, afterS: 0.1, kind: A.Ev.HIT, value: 2 };
    const base = { bar0: 0, bars: 8, sync: 8, sector: 0, key: 0, volume: [1, 0] as [number, number] };
    const none = (await A.render(base)).buffer;
    const duck = (await A.render({ ...base, events: [hit] })).buffer;
    const noDuck = (await A.render({ ...base, events: [hit], faults: { noDuck: true } })).buffer;
    const midNone = A.mid(none);
    const band = (x: Float32Array, t0: number, t1: number, f0: number, f1: number): number => a.bandDb(x, 48000, t0, t1, f0, f1);
    const delta = (x: Float32Array, t0: number, t1: number, f0: number, f1: number): number => band(x, t0, t1, f0, f1) - band(midNone, t0, t1, f0, f1);
    const midDuck = A.mid(duck);
    const midNo = A.mid(noDuck);
    const bands: [number, number][] = [[30, 150], [150, 500], [500, 2000], [2000, 16000]];
    const L = none.getChannelData(0);
    const Ld = duck.getChannelData(0);
    const clicks = {
      attack: a.maxStepDiff(Ld, 48000, hitT - 0.03, hitT + 0.06), attackBase: a.maxStepDiff(L, 48000, hitT - 0.03, hitT + 0.06),
      release: a.maxStepDiff(Ld, 48000, hitT + 0.39, hitT + 0.54), releaseBase: a.maxStepDiff(L, 48000, hitT + 0.39, hitT + 0.54),
    };
    const modeScene = async (mode: number): Promise<number> => {
      const m = (await A.render({ ...base, bars: 4, mode: mode as SimMode })).buffer;
      return band(A.mid(m), 2, 8, 30, 150);
    };
    const play = await modeScene(A.SimMode.PLAY);
    return {
      low: delta(midDuck, hitT + 0.05, hitT + 0.38, 30, 150),
      high: delta(midDuck, hitT + 0.05, hitT + 0.38, 2000, 16000),
      after: bands.map(([f0, f1]) => delta(midDuck, hitT + 0.75, hitT + 1.1, f0, f1)),
      noDuckLow: delta(midNo, hitT + 0.05, hitT + 0.38, 30, 150),
      noDuckHigh: delta(midNo, hitT + 0.05, hitT + 0.38, 2000, 16000),
      clicks,
      cruise: (await modeScene(A.SimMode.CRUISE)) - play,
      lost: (await modeScene(A.SimMode.SIGNAL_LOST)) - play,
    };
  });
  console.log(`A15 low ${r.low.toFixed(1)}, high ${r.high.toFixed(1)}, after ${r.after.map((v) => v.toFixed(2))}, noDuck ${r.noDuckLow.toFixed(1)} and ${r.noDuckHigh.toFixed(1)}`);
  console.log(`A15 clicks attack ${r.clicks.attack.toFixed(4)} vs ${r.clicks.attackBase.toFixed(4)}, release ${r.clicks.release.toFixed(4)} vs ${r.clicks.releaseBase.toFixed(4)}; CRUISE ${r.cruise.toFixed(1)}, SIGNAL_LOST ${r.lost.toFixed(1)}`);
  expect(Math.abs(r.low + 9)).toBeLessThanOrEqual(1.5);
  expect(r.high).toBeLessThanOrEqual(-25);
  for (const b of r.after) expect(Math.abs(b)).toBeLessThanOrEqual(0.5);
  expect(r.clicks.attack).toBeLessThanOrEqual(1.25 * r.clicks.attackBase);
  expect(r.clicks.release).toBeLessThanOrEqual(1.25 * r.clicks.releaseBase);
  expect(Math.abs(r.cruise + 3)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(r.lost + 6)).toBeLessThanOrEqual(1.5);
  // Control: with no duck the same checks fail.
  expect(Math.abs(r.noDuckLow + 9)).toBeGreaterThan(1.5);
  expect(r.noDuckHigh).toBeGreaterThan(-25);
});

// ---- A16 ----

test('blips: SFX only, each onset on the next grid line, in the chord', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const a = A.a;
    // One bar, in bar 0's chord: a shard every 4 steps, 40+ ms after a grid line, so each goes to the next line.
    const steps = [0, 4, 8, 12];
    const events: SceneEvent[] = steps.map((step) => ({ bar: 0, step, afterS: 0.045, kind: A.Ev.SHARD, x: 0, value: 100 }));
    const scene: SceneOptions = { bar0: 0, bars: 1, sync: 1, sector: 0, key: 0, volume: [0, 1], events, tailS: 0.5 };
    const read = async (s: SceneOptions): Promise<{ mid: Float32Array; left: Float32Array; on: number[] }> => {
      const m = await A.render(s);
      const mid = A.mid(m.buffer);
      return { mid, left: m.buffer.getChannelData(0), on: a.onsets(mid, 48000, 0, 0.0005, 0.1, 0.3).map((t) => t - A.startS) };
    };
    const real = await read(scene);
    // The same scene with neither clip stage, to read the chain's own delay. No other difference is possible.
    const direct = await read({ ...scene, faults: { noSoftClip: true } });
    const shifted = await read({ ...scene, faults: { noSoftClip: true }, events: events.map((e) => ({ ...e, afterS: 0.045 + A.stepS })) });
    const chord = A.chordAt(0, 0);
    const pitch: { want: number; margin: number }[] = [];
    steps.forEach((step, i) => {
      const t = A.startS + (step + 1) * A.stepS;
      const want = A.ladderMidi(chord, 0, i);
      const f = A.midiToHz(want);
      const at = (hz: number): number => a.goertzelDb(real.mid, 48000, t + 0.005, t + 0.1, hz);
      pitch.push({ want, margin: at(f) - Math.max(at(f * Math.pow(2, 1 / 12)), at(f * Math.pow(2, -1 / 12))) });
    });
    const chroma = a.chromaInChord(real.left, 48000, A.startS, A.chordPcs(chord, 0));
    return { on: real.on, direct: direct.on, shifted: shifted.on, pitch, chroma, stepS: A.stepS, steps };
  });
  console.log(`A16 onsets ${r.on.map((t) => t.toFixed(4))}; with no clip stage ${r.direct.map((t) => t.toFixed(4))}; pitch ${JSON.stringify(r.pitch.map((p) => [p.want, +p.margin.toFixed(1)]))}, chroma ${r.chroma.toFixed(3)}`);
  expect(r.on).toHaveLength(4);
  expect(r.direct).toHaveLength(4);
  // Plan: within 3 ms of the next grid line, read past the soft clip's constant oversampling delay (Decision log).
  const errors = r.direct.map((t, i) => Math.abs(t - (r.steps[i]! + 1) * r.stepS));
  const chainDelay = r.on.map((t, i) => t - r.direct[i]!);
  console.log(`A16 worst error ${(Math.max(...errors) * 1e3).toFixed(2)} ms; chain delay ${chainDelay.map((d) => (d * 1e3).toFixed(1))} ms`);
  for (const e of errors) expect(e).toBeLessThanOrEqual(0.003);
  for (const d of chainDelay) expect(Math.abs(d)).toBeLessThanOrEqual(0.0045);
  // Control: events one step later land one grid line later, so the check can tell lines apart.
  const wrong = r.shifted.map((t, i) => Math.abs(t - (r.steps[i]! + 1) * r.stepS));
  expect(Math.min(...wrong)).toBeGreaterThan(0.1);
  for (const p of r.pitch) expect(p.margin).toBeGreaterThan(3);
  expect(r.chroma).toBeGreaterThanOrEqual(0.8);
});

// ---- A17 ----

test('path: repeat renders agree within tolerance, tick rate does not matter, and controls differ', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const a = A.a;
    const base = { bar0: 16, bars: 4, sync: 16, sector: 0, key: 0 };
    const one = (await A.render(base)).buffer.getChannelData(0).slice();
    const two = (await A.render(base)).buffer.getChannelData(0).slice();
    const fine = (await A.render({ ...base, tickS: 0.005 })).buffer.getChannelData(0).slice();
    const other = (await A.render({ ...base, key: 1 })).buffer.getChannelData(0).slice();
    const narrow = await A.render({ ...base, windowS: 0.01, tickS: 0.025 });
    return {
      repeat: a.maxAbsDiff(one, two), tick: a.maxAbsDiff(one, fine), key: a.maxAbsDiff(one, other),
      late: narrow.stats.late, skipped: narrow.stats.skipped,
    };
  });
  console.log(`A17 repeat ${r.repeat.toExponential(2)}, tick ${r.tick.toExponential(2)}, key+1 ${r.key.toExponential(2)}, window 10 ms late ${r.late} skipped ${r.skipped}`);
  expect(r.repeat).toBeLessThanOrEqual(5e-4);
  expect(r.tick).toBeLessThanOrEqual(5e-4);
  expect(r.key).toBeGreaterThan(1e-2);
  expect(r.late + r.skipped).toBeGreaterThan(0);
});

// ---- A18 ----

test('sector: a key change arrives by fill and crash, and each side is in its own key', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async (l) => {
    const A = window.__audio!;
    const a = A.a;
    const sector = (b: number): number => (b < 6 ? 0 : 1);
    const key = (b: number): number => (b < 6 ? 0 : 7);
    const scene = { bar0: 0, bars: 12, sync: 1, sector, key, tailS: 0.3 };
    const bass = (await A.render({ ...scene, layers: [l.bass] })).buffer.getChannelData(0).slice();
    const pad = (await A.render({ ...scene, layers: [l.pad] })).buffer.getChannelData(0).slice();
    const fx = (await A.render({ ...scene, layers: [l.crash, l.riser] })).buffer;
    const mid = A.mid(fx);
    const bars: { bar: number; sector: number; key: number; margin: number; chroma: number }[] = [];
    for (const [bar, sec, k] of [[0, 0, 0], [5, 0, 0], [7, 0, 0], [8, 1, 7], [9, 1, 7], [11, 1, 7]] as const) {
      const t0 = A.startS + bar * A.barS;
      bars.push({
        bar, sector: sec, key: k,
        margin: a.bassMarginDb(bass, 48000, t0 + 0.02, t0 + 2.32, A.firstBass(bar, sec, k, 1)),
        chroma: a.chromaInChord(pad, 48000, t0 + 0.9, A.padPcs(bar, sec, k, 1)),
      });
    }
    const hi = (bar: number, from: number, to: number): number => a.bandDb(mid, 48000, A.startS + bar * A.barS + from, A.startS + bar * A.barS + to, 6000, 16000);
    return {
      bars,
      quietBar6: hi(6, 2.0, 2.3), riserBar7: hi(7, 2.0, 2.3),
      quietBar7Start: hi(7, 0.02, 0.32), crashBar8: hi(8, 0.02, 0.32),
    };
  }, { bass: Layer.BASS, pad: Layer.PAD, crash: Layer.CRASH, riser: Layer.RISER });
  for (const b of r.bars) {
    console.log(`A18 bar ${b.bar} key ${b.key}: margin ${b.margin.toFixed(1)}, chroma ${b.chroma.toFixed(3)}`);
    expect(b.margin).toBeGreaterThanOrEqual(3);
    expect(b.chroma).toBeGreaterThanOrEqual(0.85);
  }
  console.log(`A18 above 6 kHz: riser ${r.riserBar7.toFixed(1)} vs ${r.quietBar6.toFixed(1)}; crash ${r.crashBar8.toFixed(1)} vs ${r.quietBar7Start.toFixed(1)}`);
  expect(r.riserBar7 - r.quietBar6).toBeGreaterThan(20);
  expect(r.crashBar8 - r.quietBar7Start).toBeGreaterThan(20);
});

// ---- A19: no evaluate, no locator call, no waitFor before the gesture. ----

test('gesture: nothing before the first real click, then exactly one running context', async ({ page }) => {
  await installRecorder(page);
  await open(page);
  await page.mouse.click(START.x, START.y);
  await sleep(page, 300);
  const r = await readRecorder(page);
  console.log(`A19 ${JSON.stringify({ ...r, before: r.before.length })}`);
  expect(r.clicks).toBe(1);
  expect(violations(r)).toEqual([]);
  expect(r.starts).toBeGreaterThan(0);
});

test('gesture: a page left alone for 2 s, with frame running, creates nothing', async ({ page }) => {
  await installRecorder(page);
  await open(page);
  await sleep(page, 2000);
  const r = await readRecorder(page);
  const frames = await page.evaluate(() => new Promise<number>((res) => { requestAnimationFrame(() => res(1)); }));
  console.log(`A19 alone: ${JSON.stringify({ contexts: r.contexts, offline: r.offline, starts: r.starts })}`);
  expect(frames).toBe(1);
  expect(r.contexts).toBe(0);
  expect(r.offline).toBe(0);
  expect(r.starts).toBe(0);
});

test('gesture: two clicks still make one context', async ({ page }) => {
  await installRecorder(page);
  await open(page);
  await page.mouse.click(START.x, START.y);
  await sleep(page, 150);
  await page.mouse.click(START.x, START.y);
  await sleep(page, 150);
  const r = await readRecorder(page);
  expect(r.clicks).toBe(2);
  expect(violations(r)).toEqual([]);
});

test('gesture: control, the same assertion reports an eager context, and that context reads suspended', async ({ page }) => {
  await installRecorder(page);
  await open(page, '?eager=1');
  await page.mouse.click(START.x, START.y);
  await sleep(page, 300);
  const r = await readRecorder(page);
  console.log(`A19 control: ${JSON.stringify({ violations: violations(r), eager: r.eager })}`);
  expect(violations(r).length).toBeGreaterThan(0);
  expect(r.before).toContain('AudioContext');
  expect(r.eager).toBe('suspended');
});

// ---- A19h: D-009, DI-79 as restated by DI-83, with DI-86(1)'s click frame. The launch click's own cost. ----

/**
 * DI-83's budget, as literals (plans/RECONCILIATION.md, restating DI-79): the click's synchronous part less the
 * AudioContext constructor and resume(), every frame in the 2 s after the click other than the click frame, the click
 * frame over the constructor's own time, and DI-79's unchanged slice and first-sound limits. Per DI-86(1) the click
 * frame is measured from the click event's own timestamp to the end of the frame that contains it, not from the
 * frame's start; its limit stays the constructor's time plus 8 ms.
 */
const HITCH = { ownSyncMs: 8, frameMs: 33, clickOverCtorMs: 8, sliceMs: 4, soundMs: 300, windowMs: 2000 } as const;

/**
 * Faults for the controls, injected by the recorder from outside the page, so neither the engine nor the dev page holds
 * a hook. `afterSpanMs`: busy-wait in the window bubble listener after the click's span is read, which is work in the
 * click frame that the span cannot see. `stallMs`: busy-wait in the recorder's rAF callback on the first frame entered
 * `stallAtMs` or more after the click, a long frame that is not the click frame.
 */
interface HitchFaults { afterSpanMs?: number; stallAtMs?: number; stallMs?: number }

interface HitchReading {
  /** The click's dispatch, window capture to window bubble, which holds every listener on the Start button. */
  syncMs: number;
  /** The AudioContext constructor's own time, and resume()'s, for calls that began inside the click's span. */
  ctorMs: number;
  resumeMs: number;
  /**
   * DI-86(1), what (3) holds: from the click event's own timestamp to the end of the frame that contains it, the
   * entry of the first rAF callback after the click. By entry time exactly one interval contains the click, since no
   * callback can enter during it, and its end is when the next frame's work began.
   */
  clickFrameMs: number;
  /**
   * Logged and not gated: the same from the click to the end of the rAF-timestamp interval with the most overlap with
   * the click's span. A timestamp is a vsync begin time, so it can fall inside the click (D1), and when no vsync passes
   * during the click it lies up to a display period after the click's frame has finished (D3, section 10).
   */
  clickFromTsMs: number;
  clickFrameFound: boolean;
  /** How long the click event's own timestamp precedes its dispatch, the window capture listener; NaN if unusable. */
  clickLagMs: number;
  /** D2's figure, logged and not gated: the click frame's whole interval, from its start, the longer of the two. */
  clickIntervalMs: number;
  /** How long after the click frame's first callback entry the click arrived: idle time inside the click frame. */
  clickPhaseMs: number;
  /** The longest frame interval entered in the window, in either reading, other than that reading's click frame. */
  otherFrameMs: number;
  longFrames: string[];
  /** The longest engine.frame() call in the window, timed by the page from outside the engine, and how many ran. */
  sliceMs: number;
  frames: number;
  /** The first start() on a live context after the click, in ms; Infinity if none. */
  soundMs: number;
  /** The engine's kit is in place by the end of the window, so the whole build finished. Not read for the controls. */
  kitReady: boolean;
  state: string;
  contexts: number;
  errors: string[];
  /** The page navigated again during the reading, as when the dev server reloads it after a file edit: not a reading. */
  reloaded: boolean;
}

/**
 * Installed before any page script, and adding no evaluate: the click's span, every rAF callback's entry time and
 * timestamp, the AudioContext constructor's and resume()'s own times, and each source start with whether its context
 * is live.
 */
async function installHitchRecorder(page: Page, faults: HitchFaults): Promise<void> {
  await page.addInitScript((f: HitchFaults) => {
    const h = {
      click: -1, clickTs: NaN, spans: [] as number[], frames: [] as number[], starts: [] as number[],
      ctor: [] as number[], ctorAt: [] as number[], resume: [] as number[], resumeAt: [] as number[], contexts: [] as AudioContext[],
    };
    (window as unknown as { __hitch: typeof h }).__hitch = h;
    const busy = (ms: number): void => {
      const end = performance.now() + ms;
      while (performance.now() < end) { /* the fault: hold the main thread */ }
    };
    let t0 = 0;
    // The click event's own timeStamp (DI-86(1)) is a DOMHighResTimeStamp on the same origin as performance.now() and
    // the rAF timestamps; for input it is the event's creation time, so it can precede the dispatch.
    window.addEventListener('click', (ev) => {
      t0 = performance.now();
      if (h.click < 0) { h.click = t0; h.clickTs = ev.timeStamp; }
    }, true);
    window.addEventListener('click', () => {
      h.spans.push(performance.now() - t0);
      if (f.afterSpanMs !== undefined && h.spans.length === 1) busy(f.afterSpanMs);
    }, false);
    // Per frame: performance.now() at callback entry and the rAF timestamp. A rAF timestamp is the frame's begin time,
    // which can predate a stall: a 36.5 ms constructor read as a 27.8 ms rAF delta [O: D-009 probe], and the stall
    // then shows in the next frame's timestamp delta instead. So both deltas are read.
    let stalled = false;
    const rec = (t: number): void => {
      const now = performance.now();
      h.frames.push(now, t);
      if (f.stallMs !== undefined && !stalled && h.click >= 0 && now - h.click >= (f.stallAtMs ?? 0)) {
        stalled = true;
        busy(f.stallMs);
      }
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        const a = performance.now();
        super(o);
        h.ctor.push(performance.now() - a);
        h.ctorAt.push(a);
        h.contexts.push(this);
      }

      override resume(): Promise<void> {
        const a = performance.now();
        const p = super.resume();
        h.resume.push(performance.now() - a);
        h.resumeAt.push(a);
        return p;
      }
    };
    const note = (c: BaseAudioContext): void => { if (!(c instanceof OfflineAudioContext)) h.starts.push(performance.now()); };
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function patched(this: AudioScheduledSourceNode, when?: number) {
      note(this.context);
      return start.call(this, when);
    };
    if (Object.prototype.hasOwnProperty.call(AudioBufferSourceNode.prototype, 'start')) {
      const bufferStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function patchedBuffer(this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
        note(this.context);
        return bufferStart.apply(this, args);
      };
    }
  }, faults);
}

/**
 * One launch on a fresh page: open, settle for 1.5 s with nothing touching the page, a real click, then 2.2 s. These
 * pages are outside the shared fixture's console guard, so console errors are collected here and fail the reading.
 */
async function hitchOnce(page: Page, query: string, faults: HitchFaults): Promise<HitchReading> {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => { errors.push(e.message); });
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  await installHitchRecorder(page, faults);
  await page.goto(`${PAGE}${query}`);
  await new Promise((r) => { setTimeout(r, 1500); });
  await page.mouse.click(START.x, START.y);
  await new Promise((r) => { setTimeout(r, HITCH.windowMs + 200); });
  const r = await readHitch(page);
  return { ...r, errors, reloaded: navigations > 1 };
}

async function readHitch(page: Page): Promise<Omit<HitchReading, 'errors' | 'reloaded'>> {
  return page.evaluate((windowMs) => {
    const h = (window as unknown as {
      __hitch: { click: number; clickTs: number; spans: number[]; frames: number[]; starts: number[]; ctor: number[]; ctorAt: number[]; resume: number[]; resumeAt: number[]; contexts: AudioContext[] };
    }).__hitch;
    // The click's span, [k0, k1]. The constructor and resume() are taken out only for calls that began inside it.
    const k0 = h.click;
    const k1 = k0 + (h.spans[0] ?? NaN);
    const inside = (t: number): boolean => t >= k0 && t <= k1;
    let ctorMs = 0;
    for (let i = 0; i < h.ctor.length; i++) if (inside(h.ctorAt[i]!)) ctorMs += h.ctor[i]!;
    let resumeMs = 0;
    for (let i = 0; i < h.resume.length; i++) if (inside(h.resumeAt[i]!)) resumeMs += h.resume[i]!;
    // Every frame entered in the window, by its entry delta and by its timestamp delta. In each reading the click frame
    // is the one interval with the most overlap with the click's span: by entry time it is the only one, and by
    // timestamp a stall's queued frames can stamp more than one, so the one that carries the stall is taken. Every
    // other interval, in both readings, is held to the frame limit (2); the click frame is held to (3), below.
    const overlap = (a: number, b: number): number => Math.max(0, Math.min(b, k1) - Math.max(a, k0));
    const rows: { at: number; de: number; ds: number; oe: number; os: number; e1: number; s1: number }[] = [];
    let ie = -1;
    let is = -1;
    for (let i = 2; i < h.frames.length; i += 2) {
      const e0 = h.frames[i - 2]!;
      const e1 = h.frames[i]!;
      const s0 = h.frames[i - 1]!;
      const s1 = h.frames[i + 1]!;
      if (e1 < k0 || e1 > k0 + windowMs) continue;
      const row = { at: e1 - k0, de: e1 - e0, ds: s1 - s0, oe: overlap(e0, e1), os: overlap(s0, s1), e1, s1 };
      if (row.oe > 0 && (ie < 0 || row.oe > rows[ie]!.oe)) ie = rows.length;
      if (row.os > 0 && (is < 0 || row.os > rows[is]!.os)) is = rows.length;
      rows.push(row);
    }
    const found = ie >= 0;
    // The click frame's previous entry is e1 - de, and the click came k0 - (e1 - de) = de - at after it.
    const phase = found ? rows[ie]!.de - rows[ie]!.at : NaN;
    // DI-86(1): from the click event's own timestamp to the end of the frame that contains it. The frame is the entry
    // interval holding the click, and its end the next callback's entry, which is never before the click's span ends.
    // The start is never later than the dispatch began, so a timestamp that read after it could only make the reading
    // longer. A timestamp that is not a number leaves the reading NaN, which fails. The timestamp reading's value is
    // kept for the log only (see HitchReading.clickFromTsMs).
    const from = Number.isFinite(h.clickTs) ? Math.min(h.clickTs, k0) : NaN;
    const fromEntry = found ? rows[ie]!.e1 - from : NaN;
    const fromTs = is >= 0 ? rows[is]!.s1 - from : NaN;
    let interval = 0;
    let other = 0;
    const long: string[] = [];
    rows.forEach((row, i) => {
      if (i === ie) interval = Math.max(interval, row.de); else other = Math.max(other, row.de);
      if (i === is) interval = Math.max(interval, row.ds); else other = Math.max(other, row.ds);
      if (i === ie || i === is || Math.max(row.de, row.ds) > 25) {
        long.push(`+${row.at.toFixed(0)}: entry ${row.de.toFixed(1)} ts ${row.ds.toFixed(1)}${i === ie ? ' click(entry)' : ''}${i === is ? ' click(ts)' : ''}`);
      }
    });
    const A = window.__audio!;
    const cost = A.live.frameCost(k0, k0 + windowMs);
    const sound = h.starts.find((t) => t >= k0);
    const probe = A.live.probe();
    const ctx = window.__legacyCtx ?? probe.ctx;
    return {
      syncMs: h.spans[0] ?? NaN, ctorMs, resumeMs,
      clickFrameMs: fromEntry, clickFromTsMs: fromTs,
      clickFrameFound: found, clickLagMs: k0 - h.clickTs, clickIntervalMs: interval, clickPhaseMs: phase,
      otherFrameMs: other, longFrames: long,
      sliceMs: cost.worstMs, frames: cost.frames,
      soundMs: sound === undefined ? Infinity : sound - k0,
      kitReady: probe.kit !== null,
      state: ctx ? ctx.state : 'none', contexts: h.contexts.length,
    };
  }, HITCH.windowMs);
}

/** The message prefixes the controls look for, one per DI-83 limit. */
const V_OWN = 'the click less the constructor and resume()';
const V_OTHER = 'a frame other than the click frame';
const V_CLICK = 'the click frame';

/** DI-83, restating DI-79: what the check reports, empty when it passes. Every control runs this same function. */
function hitchViolations(r: HitchReading): string[] {
  const out: string[] = [];
  const own = r.syncMs - r.ctorMs - r.resumeMs;
  if (!(own <= HITCH.ownSyncMs)) out.push(`${V_OWN} ran ${own.toFixed(1)} ms (limit ${HITCH.ownSyncMs})`);
  if (!(r.otherFrameMs <= HITCH.frameMs)) out.push(`${V_OTHER} ran ${r.otherFrameMs.toFixed(1)} ms within ${HITCH.windowMs} ms of the click (limit ${HITCH.frameMs})`);
  if (!r.clickFrameFound) out.push('no frame interval overlaps the click');
  else if (!(r.clickFrameMs <= r.ctorMs + HITCH.clickOverCtorMs)) {
    out.push(`${V_CLICK}, from the click event's timestamp to its end, ran ${r.clickFrameMs.toFixed(1)} ms (limit the constructor's ${r.ctorMs.toFixed(1)} + ${HITCH.clickOverCtorMs})`);
  }
  if (!(r.sliceMs <= HITCH.sliceMs)) out.push(`one engine.frame() took ${r.sliceMs.toFixed(2)} ms (slice limit ${HITCH.sliceMs})`);
  if (!(r.soundMs <= HITCH.soundMs)) out.push(`first live source ${r.soundMs.toFixed(0)} ms after the click (limit ${HITCH.soundMs})`);
  if (r.state !== 'running') out.push(`state ${r.state}`);
  if (r.contexts !== 1) out.push(`${r.contexts} AudioContexts`);
  if (r.errors.length > 0) out.push(`console errors: ${r.errors.join(' | ')}`);
  if (r.reloaded) out.push('the page reloaded during the reading');
  return out;
}

const fmtHitch = (r: HitchReading): string =>
  `sync ${r.syncMs.toFixed(2)} ms (constructor ${r.ctorMs.toFixed(2)}, resume ${r.resumeMs.toFixed(2)}, rest ${(r.syncMs - r.ctorMs - r.resumeMs).toFixed(2)}), ` +
  `click frame from the click ${r.clickFrameMs.toFixed(1)} ms (over the constructor ${(r.clickFrameMs - r.ctorMs).toFixed(1)}; ` +
  `event timestamp ${r.clickLagMs.toFixed(2)} ms before dispatch; by timestamp, not gated, ${r.clickFromTsMs.toFixed(1)}), ` +
  `whole interval ${r.clickIntervalMs.toFixed(1)} ms (click ${r.clickPhaseMs.toFixed(1)} ms into it), ` +
  `other frames at most ${r.otherFrameMs.toFixed(1)} ms [${r.longFrames.join(', ')}], ` +
  `longest frame() ${r.sliceMs.toFixed(2)} ms over ${r.frames} frames, first sound +${r.soundMs.toFixed(0)} ms, engine kit ${r.kitReady ? 'ready' : 'not ready'} by +${HITCH.windowMs + 200} ms, ${r.state}`;

/**
 * Each run gets its own browser, so the first page's AudioContext is the first in that browser process, as on a
 * player's first launch: on this machine that constructor read 33 to 54 ms, and a second one 8 to 12 ms [O: D-009
 * probes]. The second page in the same browser is the warm case. Both are read and both are held to the budget.
 */
async function hitchPair(launch: () => Promise<Browser>, baseURL: string, query: string, faults: HitchFaults): Promise<[HitchReading, HitchReading]> {
  // A reload in the middle of a reading, from a sibling's or this task's own file edit on a shared dev server, leaves a
  // page with no click on it. That pair is not a reading, so it is taken again in a fresh browser, at most 3 times.
  for (let attempt = 1; ; attempt++) {
    const browser = await launch();
    try {
      const one = async (): Promise<HitchReading> => {
        const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
        try {
          return await hitchOnce(await context.newPage(), query, faults);
        } finally {
          await context.close();
        }
      };
      const cold = await one();
      const warm = await one();
      if (!(cold.reloaded || warm.reloaded) || attempt >= 3) return [cold, warm];
      console.log(`A19h ${query || 'D1'} ${JSON.stringify(faults)}: the page reloaded during attempt ${attempt}, taking the pair again`);
    } finally {
      await browser.close();
    }
  }
}

function hitchLauncher(info: { project: { use: { launchOptions?: Parameters<typeof chromium.launch>[0] } } }): () => Promise<Browser> {
  const o = info.project.use.launchOptions ?? {};
  return () => chromium.launch({ ...o, headless: true });
}

/** One measured pair per query, faults and worker, shared by the rows below, so each reads the same launches. */
const hitchRuns = new Map<string, Promise<[HitchReading, HitchReading]>>();
function hitchFor(info: Parameters<typeof hitchLauncher>[0], baseURL: string, query: string, tag: string, faults: HitchFaults = {}): Promise<[HitchReading, HitchReading]> {
  const key = `${query}|${JSON.stringify(faults)}`;
  let p = hitchRuns.get(key);
  if (!p) {
    p = hitchPair(hitchLauncher(info), baseURL, query, faults).then((pair) => {
      console.log(`A19h ${tag}, first launch in a fresh browser: ${fmtHitch(pair[0])}`);
      console.log(`A19h ${tag}, second launch in that browser: ${fmtHitch(pair[1])}`);
      return pair;
    });
    hitchRuns.set(key, p);
  }
  return p;
}

test('hitch: DI-83, the first launch in a fresh browser: the click less the constructor and resume() at most 8 ms, other frames at most 33 ms, the click frame from the click at most the constructor plus 8 ms', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [cold] = await hitchFor(info, baseURL!, '', 'D1');
  const v = hitchViolations(cold);
  console.log(`A19h DI-83, first launch: ${v.join('; ') || 'no violation'}`);
  expect(v).toEqual([]);
  expect(cold.kitReady).toBe(true);
});

test('hitch: DI-83, a second launch in one browser: the click less the constructor and resume() at most 8 ms, other frames at most 33 ms, the click frame from the click at most the constructor plus 8 ms', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [, warm] = await hitchFor(info, baseURL!, '', 'D1');
  const v = hitchViolations(warm);
  console.log(`A19h DI-83, second launch: ${v.join('; ') || 'no violation'}`);
  expect(v).toEqual([]);
  expect(warm.kitReady).toBe(true);
});

test('hitch: control, the pre-D1 order, everything inside the gesture, fails the click limit and the click-frame limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [cold, warm] = await hitchFor(info, baseURL!, '?legacy=1', 'control, pre-D1 order');
  const vc = hitchViolations(cold);
  const vw = hitchViolations(warm);
  console.log(`A19h control, pre-D1 order: first ${vc.join('; ') || 'no violation'}; second ${vw.join('; ') || 'no violation'}`);
  // The old order must fail on the click's own span and on the click frame in both launches, with the state running,
  // so the failure is the cost and not a broken page.
  for (const v of [vc, vw]) {
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(true);
    expect(v.some((s) => s.startsWith(V_CLICK))).toBe(true);
  }
  expect(cold.state).toBe('running');
  expect(warm.state).toBe('running');
});

test('hitch: control, a 45 ms stall 1 s after the click fails the other-frames limit, and not the click limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [cold, warm] = await hitchFor(info, baseURL!, '', 'control, 45 ms stall at +1 s', { stallAtMs: 1000, stallMs: 45 });
  const vc = hitchViolations(cold);
  const vw = hitchViolations(warm);
  console.log(`A19h control, 45 ms stall at +1 s: first ${vc.join('; ') || 'no violation'}; second ${vw.join('; ') || 'no violation'}`);
  for (const v of [vc, vw]) {
    expect(v.some((s) => s.startsWith(V_OTHER))).toBe(true);
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(false);
  }
});

test('hitch: control, 20 ms of work after the click span fails the click-frame limit, and not the click limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [cold, warm] = await hitchFor(info, baseURL!, '', 'control, 20 ms after the span', { afterSpanMs: 20 });
  const vc = hitchViolations(cold);
  const vw = hitchViolations(warm);
  console.log(`A19h control, 20 ms after the span: first ${vc.join('; ') || 'no violation'}; second ${vw.join('; ') || 'no violation'}`);
  for (const v of [vc, vw]) {
    expect(v.some((s) => s.startsWith(V_CLICK))).toBe(true);
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(false);
  }
});

// ---- A20 ----

test('live: 12 s at SYNC 16 with no missed step, in budget, at level', async ({ page }) => {
  test.setTimeout(60_000);
  await unlockLive(page, { sync: 16 });
  await page.evaluate(() => { window.__audio!.live.resetTicks(); });
  await sleep(page, 1000);
  await page.evaluate(() => { window.__audio!.live.resetTap(); });
  await sleep(page, 11000);
  const s = await page.evaluate(() => window.__audio!.live.stats());
  console.log(`A20 ${JSON.stringify(s)}`);
  expect(s.state).toBe('running');
  expect(s.late).toBe(0);
  expect(s.skipped).toBe(0);
  expect(s.tickP99).toBeLessThanOrEqual(2);
  expect(s.tickMax).toBeLessThanOrEqual(10);
  expect(s.peakSources).toBeLessThanOrEqual(96);
  expect(s.peakSources).toBeGreaterThan(20);
  expect(s.tapMeanDb).toBeGreaterThanOrEqual(-30);
  expect(s.tapPeak).toBeLessThanOrEqual(0.985);
  expect(s.tapPeak).toBeGreaterThan(0.05);
  expect(s.anchors).toBe(1);
});

test('live: cues, modes, wind, volume and a sector change, through the real frame', async ({ page }) => {
  test.setTimeout(90_000);
  await unlockLive(page, { sync: 8 });
  await sleep(page, 500);

  // Every cue the engine handles, through scripted frames, none of them able to bring it down.
  const cues = await page.evaluate(async () => {
    const A = window.__audio!;
    const live = A.live;
    const Ev = A.Ev;
    const before = live.stats().created;
    live.emit(Ev.SHARD, 10, 100);
    live.emit(Ev.SHARD, -10, 100);
    await new Promise((res) => setTimeout(res, 300));
    const chain = live.stats().chain;
    live.emit(Ev.SHARD, 0, 0);
    live.emit(Ev.GATE, 0, 500);
    live.emit(Ev.GRAZE, 30, 10);
    live.emit(Ev.GRADE, 0, 1000, 1);
    await new Promise((res) => setTimeout(res, 300));
    live.emit(Ev.GATE_MISS, 0, 0);
    await new Promise((res) => setTimeout(res, 100));
    const afterMiss = live.stats().chain;
    live.emit(Ev.SECTOR, 0, 3);
    live.emit(Ev.BOOST_ON, 0, 0);
    live.emit(Ev.BOOST_OFF, 0, 0);
    await new Promise((res) => setTimeout(res, 100));
    return { chain, afterMiss, created: live.stats().created - before, s: live.stats() };
  });
  console.log(`A20 cues: chain ${cues.chain} then ${cues.afterMiss}, ${cues.created} sources, disposed ${cues.s.disposed}`);
  expect(cues.chain).toBe(2);
  expect(cues.afterMiss).toBe(0);
  expect(cues.s.disposed).toBe(false);

  // Hit and SIGNAL_LOST in one frame, then a mode that follows sim.mode. The tap falls while muffled.
  const modes = await page.evaluate(async () => {
    const A = window.__audio!;
    const live = A.live;
    const mean = async (ms: number): Promise<number> => {
      live.resetTap();
      await new Promise((res) => setTimeout(res, ms));
      return live.stats().tapMeanDb;
    };
    const play = await mean(2400);
    live.emit(A.Ev.HIT, 0, 0);
    live.emit(A.Ev.SIGNAL_LOST, 0, 0);
    live.set({ mode: A.SimMode.SIGNAL_LOST });
    await new Promise((res) => setTimeout(res, 1800));
    const lost = await mean(2400);
    live.set({ mode: A.SimMode.CRUISE });
    await new Promise((res) => setTimeout(res, 300));
    const cruise = await mean(2400);
    live.set({ mode: A.SimMode.PLAY });
    await new Promise((res) => setTimeout(res, 300));
    const back = await mean(2400);
    return { play, lost, cruise, back, s: live.stats() };
  });
  console.log(`A20 modes: PLAY ${modes.play.toFixed(1)}, SIGNAL_LOST ${modes.lost.toFixed(1)}, CRUISE ${modes.cruise.toFixed(1)}, back ${modes.back.toFixed(1)} dBFS`);
  expect(modes.lost).toBeLessThan(modes.play - 3);
  expect(modes.cruise).toBeLessThan(modes.play - 1);
  expect(Math.abs(modes.back - modes.play)).toBeLessThan(3);
  expect(modes.s.disposed).toBe(false);

  // Wind follows sim.speed, and volume reaches the tap.
  const levels = await page.evaluate(async () => {
    const live = window.__audio!.live;
    const mean = async (ms: number): Promise<number> => {
      live.resetTap();
      await new Promise((res) => setTimeout(res, ms));
      return live.stats().tapMeanDb;
    };
    live.engine.setVolume(0, 1);
    await new Promise((res) => setTimeout(res, 200));
    const calm = await mean(800);
    live.set({ speed: 150 });
    await new Promise((res) => setTimeout(res, 900));
    const windy = await mean(800);
    live.set({ speed: 80 });
    await new Promise((res) => setTimeout(res, 1200));
    const calmAgain = await mean(800);
    // Under reduced motion, cruise and max are .6 times as fast, so full boost is 90 u/s and calm is 48.
    live.set({ speed: 90, reducedMotion: true });
    await new Promise((res) => setTimeout(res, 900));
    const reducedWindy = await mean(800);
    live.set({ speed: 48 });
    await new Promise((res) => setTimeout(res, 1200));
    const reducedCalm = await mean(800);
    live.set({ speed: 80, reducedMotion: false });
    live.engine.setVolume(0, 0);
    await new Promise((res) => setTimeout(res, 300));
    const muted = await mean(500);
    live.engine.setVolume(1, 1);
    live.engine.setVolume(NaN, 2);
    await new Promise((res) => setTimeout(res, 200));
    const full = await mean(1200);
    return { calm, windy, calmAgain, reducedWindy, reducedCalm, muted, full };
  });
  console.log(`A20 sfx bus only: calm ${levels.calm.toFixed(1)}, full boost ${levels.windy.toFixed(1)}, calm again ${levels.calmAgain.toFixed(1)}; reduced motion ${levels.reducedWindy.toFixed(1)} then ${levels.reducedCalm.toFixed(1)}; muted ${levels.muted.toFixed(0)}; back at full ${levels.full.toFixed(1)} dBFS`);
  expect(levels.reducedWindy).toBeGreaterThan(levels.windy - 3);
  expect(levels.reducedCalm).toBeLessThan(levels.reducedWindy - 20);
  expect(levels.windy).toBeGreaterThan(-60);
  expect(levels.windy).toBeGreaterThan(levels.calm + 20);
  expect(levels.calmAgain).toBeLessThan(levels.windy - 20);
  expect(levels.muted).toBeLessThan(-80);
  expect(levels.full).toBeGreaterThan(-30);

  // A live sector and key change arrives through the fill, within the 5-bar wait.
  const change = await page.evaluate(async () => {
    const live = window.__audio!.live;
    const before = live.stats();
    live.set({ sector: 3, key: 9 });
    const t0 = performance.now();
    while (live.stats().sectorChanges === before.sectorChanges && performance.now() - t0 < 14000) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const s = live.stats();
    return { waited: (performance.now() - t0) / 1000, changes: s.sectorChanges - before.sectorChanges, fills: s.fills - before.fills, s };
  });
  console.log(`A20 sector: ${change.changes} change after ${change.waited.toFixed(2)} s, ${change.fills} fills`);
  expect(change.changes).toBe(1);
  expect(change.fills).toBeGreaterThanOrEqual(1);
  expect(change.waited).toBeLessThanOrEqual(12.12 + 0.2);

  // At the cap blips and gate stabs drop, and the engine carries on.
  const cap = await page.evaluate(async (limit) => {
    const A = window.__audio!;
    const live = A.live;
    const before = live.stats().dropped;
    for (let i = 0; i < 40; i++) live.emit(A.Ev.GATE, 0, 500);
    await new Promise((res) => setTimeout(res, 60));
    for (let i = 0; i < 3; i++) live.emit(A.Ev.SHARD, 0, 100);
    await new Promise((res) => setTimeout(res, 60));
    const s = live.stats();
    // The same storm straight into the voices, in one task, so nothing else starts between the two counts: a stab is
    // admitted only under cap - 8, so 40 stabs of 4 saws can end at most 3 above that.
    const v = live.probe().voices!;
    const t = live.probe().ctx!.currentTime + 0.05;
    const live0 = v.live;
    const dropped0 = v.dropped;
    for (let i = 0; i < 40; i++) v.stab(t, 69, 72, 76, 81, 1);
    return { dropped: s.dropped - before, peak: s.peakSources, disposed: s.disposed, live0, live1: v.live, stabDropped: v.dropped - dropped0, limit };
  }, MAX_LIVE_SOURCES);
  console.log(`A20 cap: ${cap.dropped} dropped through the frame, peak ${cap.peak}, disposed ${cap.disposed}; 40 stabs straight in: live ${cap.live0} to ${cap.live1}, ${cap.stabDropped} dropped, cap ${cap.limit}`);
  expect(cap.dropped).toBeGreaterThan(0);
  expect(cap.disposed).toBe(false);
  expect(cap.live1).toBeLessThanOrEqual(Math.max(cap.live0, cap.limit - 8 - 1 + 4));
  expect(cap.stabDropped).toBeGreaterThan(0);
});

// ---- A21 ----

interface ResumeRun {
  phase: number;
  /** ctx.currentTime when resume() ran. The master's ramp starts there, and audio time is still frozen at it. */
  c0: number;
  /** ctx.sampleRate, for the analysers' window length. */
  rate: number;
  inFirst300: number;
  firstStep: number;
  formOrigin: number;
  anchorsBefore: number;
  anchorsAfter: number;
  skippedInRun: number;
  trace: TraceEntry[];
  early70: number;
  levels: number[];
  state: string;
}

/**
 * While suspended, moves the scripted clock to just before step `step` of the next form bar `bar`, then resumes
 * twice, traces both taps per frame for 700 ms, and counts AudioScheduledSourceNode.start calls stamped within
 * 300 ms of resume(). Nothing reads the scripted clock while suspended, and resume anchors to wherever it is.
 * `noFade` cancels the master's ramp from outside, straight after resume: the fade gate's own control.
 */
async function resumeAt(page: Page, bar: number, step: number, noFade: boolean): Promise<ResumeRun> {
  return page.evaluate(async ({ bar, step, noFade }) => {
    const A = window.__audio!;
    const live = A.live;
    const rec = (window as unknown as { __rec: { log: { what: string; t: number }[] } }).__rec;
    const p = live.probe();
    const seq = p.sequencer!;
    const ctx = p.ctx!;
    const formOrigin = seq.formOrigin;
    // stepAtOrAfter reads the beat comp seconds ahead, and the anchoring frame comes up to a frame after resume(),
    // so resume 0.6 steps (90 ms) plus comp before the target step.
    const lead = 0.6 + p.clock.comp / A.stepS;
    const nowStep = live.scriptedBeat() * 4;
    const k = Math.ceil((Math.floor(nowStep / 16) + 2 - formOrigin - bar) / 32);
    const resumeStep = (formOrigin + bar + 32 * k) * 16 + step - lead;
    live.jump((resumeStep - 0.5 - nowStep) * A.stepS);
    while (live.scriptedBeat() * 4 < resumeStep) await new Promise((res) => setTimeout(res, 1));
    const phase = live.stepInBar();
    const stats0 = seq.stats;
    const scheduled0 = stats0.scheduled;
    const skipped0 = stats0.skipped;
    const anchorsBefore = p.clock.anchors;
    const c0 = ctx.currentTime;
    live.trace(true);
    const t0 = performance.now();
    live.engine.resume();
    live.engine.resume();
    if (noFade) {
      const G = p.graph!.master.gain;
      G.cancelScheduledValues(0);
      G.setValueAtTime(1, c0);
    }
    await new Promise((res) => setTimeout(res, 70));
    const early70 = live.stats().tapRmsDb;
    await new Promise((res) => setTimeout(res, 630));
    live.trace(false);
    const trace = live.traceLog().slice();
    const inFirst300 = rec.log.filter((e) => e.what === 'start' && e.t >= t0 && e.t <= t0 + 300).length;
    // The first step scheduled, from the anchoring frame: no step before it was late or skipped, because restart
    // starts at or after now.
    const anchored = trace.find((e) => e.anchors > anchorsBefore);
    const firstStep = anchored ? anchored.nextStep - (anchored.scheduled - scheduled0) : NaN;
    const skippedInRun = anchored ? anchored.skipped - skipped0 : NaN;
    const levels: number[] = [];
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, 100));
      levels.push(live.stats().tapRmsDb);
    }
    return {
      phase, c0, rate: ctx.sampleRate, inFirst300, firstStep, formOrigin, anchorsBefore, anchorsAfter: p.clock.anchors, skippedInRun,
      trace, early70, levels, state: live.stats().state,
    };
  }, { bar, step, noFade });
}

interface FadeReading {
  early: number[];
  /** Each reading 150 to 250 ms into the ramp, over the settled ratio, minus what a 300 ms linear ramp reads there. */
  mid: number[];
  /** The median of `mid`, and the ramp length it implies. */
  midDev: number;
  midRampMs: number;
  settled: number;
  violation: string | null;
}

/**
 * Plan section 4: resume() ramps the master from 0 over 300 ms. A literal, not mix.ts's RESUME_RAMP_S, so that a
 * changed ramp fails here instead of moving the expectation with it.
 */
const SPEC_RAMP_S = 0.3;
/** devPage's two analysers both use fftSize 2048. */
const TAP_FFT = 2048;
/**
 * Mid-ramp tolerance, 1.76 dB. While both are still ramping, a 200 ms or 450 ms ramp reads 20 log10(1.5) = 3.52 dB
 * above or below a 300 ms one, so the limit is half of that: a reading must imply a ramp between the geometric
 * midpoints, 245 and 367 ms, and each of those mutants sits 1.76 dB beyond the line.
 */
const MID_TOL_DB = 10 * Math.log10(1.5);

/**
 * What a linear ramp from 0 at c0 to 1 at c0 + rampS reads as output over input, in dB, in an analyser window of
 * windowS seconds that ends tau after c0: the window's mean of gain squared, taking the input as steady.
 */
function rampWindowDb(tau: number, windowS: number, rampS: number): number {
  const F = (t: number): number => (t <= 0 ? 0 : t <= rampS ? (t * t * t) / (3 * rampS * rampS) : rampS / 3 + (t - rampS));
  return 10 * Math.log10((F(tau) - F(tau - windowS)) / windowS);
}

/**
 * The 300 ms master fade-in on resume, read as output over input: the output after the last stage against the
 * master's two inputs, in the same frame, so the music's own level cancels. In audio time from resume(), readings
 * from 45 ms (when the 2048-sample window holds only new audio) to 120 ms must sit at least 6 dB under the settled
 * ratio from 400 ms on. A linear ramp reads about -10 dB or lower there; no ramp reads about 0. That alone passes a
 * 200 ms ramp and any longer one (V2-T07), so the length is pinned too: the median reading from 150 to 250 ms, over
 * the settled ratio, must be within MID_TOL_DB of what a 300 ms linear ramp reads in the same window.
 */
function fadeCheck(trace: readonly TraceEntry[], c0: number, windowS: number): FadeReading {
  const ratio = (e: TraceEntry): number => e.postDb - e.preDb;
  const heard = trace.filter((e) => e.preDb > -70);
  const late = heard.filter((e) => e.at - c0 >= 0.4).map(ratio).sort((x, y) => x - y);
  const early = heard.filter((e) => e.at - c0 >= 0.045 && e.at - c0 <= 0.12).map(ratio);
  const settled = late.length > 0 ? late[Math.floor(late.length / 2)]! : NaN;
  const mid = heard
    .filter((e) => e.at - c0 >= 0.15 && e.at - c0 <= 0.25)
    .map((e) => ratio(e) - settled - rampWindowDb(e.at - c0, windowS, SPEC_RAMP_S));
  const sorted = mid.slice().sort((x, y) => x - y);
  const n = sorted.length;
  const midDev = n > 0 ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : NaN;
  const midRampMs = 1e3 * SPEC_RAMP_S * Math.pow(10, -midDev / 20);
  const base = { early, mid, midDev, midRampMs, settled };
  if (late.length < 3) return { ...base, violation: `only ${late.length} settled readings` };
  const problems: string[] = [];
  if (early.length === 0) {
    problems.push('no reading 45 to 120 ms into the ramp');
  } else {
    const worst = Math.max(...early);
    if (worst > settled - 6) problems.push(`output over input ${worst.toFixed(1)} dB within 120 ms of resume, settled ${settled.toFixed(1)} dB: no fade-in`);
  }
  if (n < 3) {
    problems.push(`only ${n} readings 150 to 250 ms into the ramp`);
  } else if (!(Math.abs(midDev) <= MID_TOL_DB)) {
    problems.push(`150 to 250 ms reads ${midDev.toFixed(2)} dB off a ${SPEC_RAMP_S * 1e3} ms linear ramp, limit ${MID_TOL_DB.toFixed(2)}, as a ${midRampMs.toFixed(0)} ms ramp: not ${SPEC_RAMP_S * 1e3} ms`);
  }
  return { ...base, violation: problems.length > 0 ? problems.join('; ') : null };
}

test('lifecycle: suspend, resume at the worst form position with no burst and a fade-in, idempotence, dispose', async ({ page }) => {
  test.setTimeout(120_000);
  // DI-59: the worst position over all 32 form bars and 6 sectors at SYNC 16, by the pure count. Key 0 reaches the
  // worst count over all 12 keys (sequencer.test.ts).
  const w = worstResume(16, 0);
  const a = createBarPattern();
  const b = createBarPattern();
  const sector: SectorMusic = { index: w.sector, key: 0, fillNext: false, entered: false };
  console.log(`A21 worst position: form bar ${w.bar}, step ${w.step}, sector ${w.sector}, key 0, bound ${w.sources} sources`);

  await installRecorder(page);
  await open(page, `?sync=16&sector=${w.sector}&key=0`);
  await page.mouse.click(START.x, START.y);
  await waitLive(page);
  await sleep(page, 1500);

  // Suspend twice; the second changes nothing.
  await page.evaluate(() => { window.__audio!.live.engine.suspend(); });
  await sleep(page, 50);
  const suspended = await page.evaluate(() => {
    const s = window.__audio!.live.stats();
    return { state: s.state, ticks: s.tickCount, live: s.liveSources };
  });
  await sleep(page, 1000);
  const frozen = await page.evaluate(() => window.__audio!.live.stats().tickCount);
  console.log(`A21 suspended ${JSON.stringify(suspended)}, ticks after 1 s ${frozen}`);
  expect(suspended.state).toBe('suspended');
  expect(suspended.live).toBe(0);
  expect(frozen).toBe(suspended.ticks);
  await page.evaluate(() => { window.__audio!.live.engine.suspend(); });
  await sleep(page, 2000);

  // Resume at the worst position. A loaded machine can delay the anchoring frame past the target step; then the
  // run is not at the worst position, so suspend and try the next occurrence, at most 3 times.
  let run: ResumeRun | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await page.evaluate(() => { window.__audio!.live.engine.suspend(); });
      await sleep(page, 1000);
    }
    const r = await resumeAt(page, w.bar, w.step, false);
    const formBar = (((Math.floor(r.firstStep / 16) - r.formOrigin) % 32) + 32) % 32;
    const inBar = r.firstStep - Math.floor(r.firstStep / 16) * 16;
    console.log(`A21 attempt ${attempt + 1}: resumed at phase ${r.phase.toFixed(2)}, first step form bar ${formBar} step ${inBar}`);
    if (formBar === w.bar && inBar === w.step) {
      run = r;
      break;
    }
  }
  expect(run, 'no attempt resumed at the worst position').not.toBeNull();
  const r = run!;
  const bound = resumeSources(w.bar, w.step, sector, 16, a, b);
  const fade = fadeCheck(r.trace, r.c0, TAP_FFT / r.rate);
  console.log(`A21 resume at form bar ${w.bar} step ${w.step}: ${r.inFirst300} sources in the first 300 ms, bound ${bound}; anchors ${r.anchorsBefore} to ${r.anchorsAfter}, skipped ${r.skippedInRun}`);
  console.log(`A21 fade: output over input ${fade.early.map((v) => v.toFixed(1))} dB from 45 to 120 ms, settled ${fade.settled.toFixed(1)} dB, ${r.trace.length} frames; tap at 70 ms ${r.early70.toFixed(0)}, then ${r.levels.map((v) => v.toFixed(0))}; ${fade.violation ?? 'no violation'}`);
  console.log(`A21 fade length: 150 to 250 ms off a ${SPEC_RAMP_S * 1e3} ms linear ramp ${fade.mid.map((v) => v.toFixed(2))} dB, median ${fade.midDev.toFixed(2)} (limit ${MID_TOL_DB.toFixed(2)}), as a ${fade.midRampMs.toFixed(0)} ms ramp`);
  expect(r.state).toBe('running');
  expect(bound).toBe(w.sources);
  expect(r.skippedInRun).toBe(0);
  expect(r.inFirst300).toBeLessThanOrEqual(bound);
  expect(Math.max(...r.levels)).toBeGreaterThan(-40);
  expect(fade.violation).toBeNull();

  // Control for the fade gate: the same resume with the ramp cancelled from outside. The same check must report it.
  await page.evaluate(() => { window.__audio!.live.engine.suspend(); });
  await sleep(page, 1000);
  const ctl = await resumeAt(page, w.bar, w.step, true);
  const ctlFade = fadeCheck(ctl.trace, ctl.c0, TAP_FFT / ctl.rate);
  console.log(`A21 fade control, ramp cancelled: output over input ${ctlFade.early.map((v) => v.toFixed(1))} dB, settled ${ctlFade.settled.toFixed(1)} dB, 150 to 250 ms median ${ctlFade.midDev.toFixed(2)} dB off; ${ctlFade.violation ?? 'no violation'}`);
  expect(ctlFade.violation).not.toBeNull();
  expect(ctlFade.early.length).toBeGreaterThan(0);
  // The length check on its own also rejects it.
  expect(ctlFade.mid.length).toBeGreaterThanOrEqual(3);
  expect(Math.abs(ctlFade.midDev)).toBeGreaterThan(MID_TOL_DB);

  // The bound counts sources by SOURCES_PER_NOTE. Each voice, played once on the live engine, starts exactly that.
  const perVoice = await page.evaluate((L) => {
    const A = window.__audio!;
    const p = A.live.probe();
    const v = p.voices!;
    const rec = (window as unknown as { __rec: { starts: number } }).__rec;
    const t = p.ctx!.currentTime + 0.05;
    const count = (f: () => void): number => {
      const before = rec.starts;
      f();
      return rec.starts - before;
    };
    const pat = A.pattern(0, 0, 0, 16);
    let padVoices = 0;
    for (let i = 0; i < pat.count; i++) if (pat.layer[i] === L.PAD) padVoices += 1;
    // The arp and hats drop at the cap, so they go first, while the live count is lowest.
    const live0 = v.live;
    const arp = count(() => v.arp(t, 76, 0.18, 1));
    const hat = count(() => v.oneShot(L.HAT, t, 1, 1));
    return {
      live0, arp, hat,
      kick: count(() => v.oneShot(L.KICK, t, 1, 1)),
      tom: count(() => v.oneShot(L.TOM, t, 1, 1.5)),
      bass: count(() => v.bass(t, 40, 0.2, 1)),
      lead: count(() => v.lead(t, 72, 0.3, 1)),
      padPerVoice: count(() => v.padChord(t, pat, 1)) / padVoices,
    };
  }, Layer);
  console.log(`A21 sources per note on the live voices: ${JSON.stringify(perVoice)}`);
  expect(perVoice.kick).toBe(SOURCES_PER_NOTE[Layer.KICK]);
  expect(perVoice.hat).toBe(SOURCES_PER_NOTE[Layer.HAT]);
  expect(perVoice.tom).toBe(SOURCES_PER_NOTE[Layer.TOM]);
  expect(perVoice.bass).toBe(SOURCES_PER_NOTE[Layer.BASS]);
  expect(perVoice.padPerVoice).toBe(SOURCES_PER_NOTE[Layer.PAD]);
  expect(perVoice.arp).toBe(SOURCES_PER_NOTE[Layer.ARP]);
  expect(perVoice.lead).toBe(SOURCES_PER_NOTE[Layer.LEAD]);

  // Control for the source bound: a run that replays the 3 s gap, 20 steps up to the same first step in the same
  // form, exceeds the bound on the same counter.
  const replay = await page.evaluate((end) => {
    const live = window.__audio!.live;
    const rec = (window as unknown as { __rec: { starts: number } }).__rec;
    const before = rec.starts;
    live.replayGap(20, end);
    return rec.starts - before;
  }, r.firstStep);
  console.log(`A21 control: replaying the gap starts ${replay} sources, bound ${bound}`);
  expect(replay).toBeGreaterThan(bound);

  const final = await page.evaluate(async () => {
    const live = window.__audio!.live;
    const probe = live.probe();
    live.engine.dispose();
    await new Promise((res) => setTimeout(res, 100));
    const state = probe.ctx!.state;
    // Every later call is silent.
    live.engine.suspend();
    live.engine.resume();
    live.engine.setVolume(0.2, 0.2);
    await live.engine.unlock();
    live.engine.dispose();
    return { state, disposed: live.probe().disposed, contexts: (window as unknown as { __rec: { contexts: unknown[] } }).__rec.contexts.length };
  });
  console.log(`A21 dispose: ${JSON.stringify(final)}`);
  expect(final.state).toBe('closed');
  expect(final.disposed).toBe(true);
  expect(final.contexts).toBe(1);
});

test('lifecycle: suspend before unlock is remembered, and setVolume before unlock is applied', async ({ page }) => {
  await open(page);
  // evaluate grants activation, so this test is not about autoplay: it is about the remembered calls.
  const r = await page.evaluate(async () => {
    const A = window.__audio!;
    const e = A.live.engine;
    e.setVolume(0.25, 0.5);
    e.suspend();
    await e.unlock();
    const state = A.live.probe().ctx!.state;
    e.resume();
    await new Promise((res) => setTimeout(res, 200));
    return { state, after: A.live.probe().ctx!.state };
  });
  console.log(`A21 remembered: ${JSON.stringify(r)}`);
  expect(r.state).toBe('suspended');
  expect(r.after).toBe('running');
});

// ---- A22 ----

test('retry: a real click recovers a context suspended behind the engine, a real Escape does not', async ({ page }) => {
  await page.addInitScript(() => {
    const counts = { added: 0, removed: 0 };
    (window as unknown as { __listeners: typeof counts }).__listeners = counts;
    const types = ['pointerup', 'click', 'keydown'];
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, fn: EventListener, o?: boolean) => {
      if (o === true && types.includes(type)) counts.added += 1;
      add(type, fn, o);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, fn: EventListener, o?: boolean) => {
      if (o === true && types.includes(type)) counts.removed += 1;
      remove(type, fn, o);
    }) as typeof document.removeEventListener;
  });
  await unlockLive(page, { sync: 4 });
  await sleep(page, 400);
  await page.evaluate(async () => {
    await window.__audio!.live.probe().ctx!.suspend();
  });
  await sleep(page, 200);
  const armed = await page.evaluate(() => window.__audio!.live.stats());
  expect(armed.state).toBe('suspended');
  expect(armed.retryArmed).toBe(true);

  await page.keyboard.press('Escape');
  await sleep(page, 300);
  const afterEscape = await page.evaluate(() => window.__audio!.live.stats());
  console.log(`A22 after Escape: ${afterEscape.state}, armed ${afterEscape.retryArmed}`);
  expect(afterEscape.state).toBe('suspended');
  expect(afterEscape.retryArmed).toBe(true);

  await page.mouse.click(1200, 700);   // not on a control
  await sleep(page, 300);
  const afterClick = await page.evaluate(() => window.__audio!.live.stats());
  console.log(`A22 after click: ${afterClick.state}, armed ${afterClick.retryArmed}`);
  expect(afterClick.state).toBe('running');
  expect(afterClick.retryArmed).toBe(false);
  const listeners = await page.evaluate(() => (window as unknown as { __listeners: { added: number; removed: number } }).__listeners);
  console.log(`A22 capture listeners ${JSON.stringify(listeners)}`);
  expect(listeners.added).toBe(3);
  expect(listeners.removed).toBe(3);
});

test('retry: unlock resolves within 1100 ms even if the context never runs', async ({ page }) => {
  // An addInitScript stub of resume, so the state stays suspended whatever policy says.
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        super(o);
        void super.suspend();
      }
      override resume(): Promise<void> {
        return Promise.resolve();
      }
    };
  });
  await open(page);
  await page.mouse.click(START.x, START.y);
  const r = await page.evaluate(async () => {
    const e = window.__audio!.live.engine;
    await new Promise((res) => setTimeout(res, 100));
    const t0 = performance.now();
    await e.unlock();
    return { ms: performance.now() - t0, state: window.__audio!.live.probe().ctx?.state ?? 'none', armed: window.__audio!.live.stats().retryArmed };
  });
  console.log(`A22 unlock resolved in ${r.ms.toFixed(0)} ms, state ${r.state}, armed ${r.armed}`);
  expect(r.state).toBe('suspended');
  expect(r.ms).toBeLessThanOrEqual(1100);
  expect(r.ms).toBeGreaterThan(900);
  expect(r.armed).toBe(true);
});

// ---- A23 ----

test('drift: a +50 ms clock jump re-anchors once within 1 s, and an idle page never does', async ({ page }) => {
  test.setTimeout(120_000);
  await unlockLive(page, { sync: 8 });
  await sleep(page, 2000);
  const idle0 = await page.evaluate(() => window.__audio!.live.stats().anchors);
  await sleep(page, 10000);
  const idle = await page.evaluate(() => window.__audio!.live.stats());
  console.log(`A23 idle: anchors ${idle0} then ${idle.anchors}, ema ${idle.emaMs.toFixed(2)} ms`);
  expect(idle.anchors).toBe(idle0);
  expect(idle.anchors).toBe(1);

  const r = await page.evaluate(async () => {
    const live = window.__audio!.live;
    const before = live.stats().anchors;
    live.jump(0.05);
    const t0 = performance.now();
    let at = -1;
    while (performance.now() - t0 < 3000) {
      await new Promise((res) => setTimeout(res, 16));
      if (at < 0 && live.stats().anchors > before) at = performance.now() - t0;
    }
    const s = live.stats();
    return { at, count: s.anchors - before, ema: s.emaMs };
  });
  console.log(`A23 jump: re-anchored after ${r.at.toFixed(0)} ms, ${r.count} re-anchors, then ema ${r.ema.toFixed(2)} ms`);
  expect(r.count).toBe(1);
  expect(r.at).toBeGreaterThan(0);
  expect(r.at).toBeLessThan(1000);
  expect(Math.abs(r.ema)).toBeLessThan(5);
});

// ---- A24 ----

test('budget: frame() mean and the heaviest step', async ({ page }) => {
  await unlockLive(page, { sync: 16 });
  await page.evaluate(() => { window.__audio!.live.resetTicks(); });
  await sleep(page, 6000);
  const r = await page.evaluate(() => {
    const live = window.__audio!.live;
    live.frameProbe(10000);   // warm-up
    const mean = live.frameProbe(10000);
    const read = live.clockReadProbe(10000);
    return { mean, read, s: live.stats() };
  });
  console.log(`A24 frame mean ${(r.mean * 1e3).toFixed(2)} us; one clock read ${(r.read * 1e3).toFixed(3)} us; heaviest tick ${r.s.tickMax.toFixed(2)} ms, p99 ${r.s.tickP99.toFixed(2)} ms`);
  expect(r.mean).toBeLessThanOrEqual(0.02);
  expect(r.s.tickMax).toBeLessThanOrEqual(5);
});

// ---- A25 ----

interface FrameCost { hz: number; frameBytesPerS: number; tickBytesPerS: number; parts: Record<string, number> }

/** Bytes attributed under engine.ts's frame and tick, by the sampling profiler. The page's own view building is excluded. */
async function sampleFrameCost(page: Page, cdp: CDPSession, seconds: number): Promise<FrameCost> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  });
  await sleep(page, seconds * 1000);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  interface Node { selfSize: number; callFrame: { functionName: string; url: string }; children: Node[] }
  let inFrame = 0;
  let inTick = 0;
  const parts: Record<string, number> = {};
  const attribute = (n: Node, under: string): void => {
    const name = n.callFrame.functionName;
    let at = under;
    if (n.callFrame.url.includes('/src/audio/engine.ts') && (name === 'frame' || name === 'tick')) at = name;
    if (at === 'frame') {
      inFrame += n.selfSize;
      parts[name] = (parts[name] ?? 0) + Math.round(n.selfSize / seconds);
    }
    if (at === 'tick') inTick += n.selfSize;
    for (const c of n.children) attribute(c, at);
  };
  attribute(profile.head as unknown as Node, '');
  const hz = await page.evaluate(() => new Promise<number>((res) => {
    let n = 0;
    const t0 = performance.now();
    const step = (): void => {
      n += 1;
      if (performance.now() - t0 >= 1000) res(n);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  return { hz, frameBytesPerS: inFrame / seconds, tickBytesPerS: inTick / seconds, parts };
}

test('alloc: sampling profiler over no-event frames, with a control', async ({ page }) => {
  await unlockLive(page, { sync: 16 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const sampled = async (expression: string): Promise<number> => {
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
    });
    await cdp.send('Runtime.evaluate', { expression });
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    let total = 0;
    const walk = (n: { selfSize: number; children: unknown[] }): void => {
      total += n.selfSize;
      for (const c of n.children) walk(c as { selfSize: number; children: unknown[] });
    };
    walk(profile.head as unknown as { selfSize: number; children: unknown[] });
    return total;
  };
  // Stop the page's own frames, because viewAt allocates by design: only engine.frame is under test.
  await page.evaluate(() => {
    window.__audio!.live.setFrames(false);
    window.__audio!.live.frameProbe(20000);
  });
  const frames = await sampled('window.__audio.live.frameProbe(100000); 0');
  const control = await sampled('window.__audio.allocProbe(100000); 0');
  const reads = await sampled('window.__audio.live.clockReadProbe(100000); 0');
  console.log(`A25 frames ${(frames / 1024).toFixed(1)} KB per 1e5 calls; allocProbe ${(control / 1048576).toFixed(2)} MB; 1e5 reads of currentTime ${(reads / 1024).toFixed(1)} KB`);
  expect(frames).toBeLessThanOrEqual(64 * 1024);
  expect(control).toBeGreaterThanOrEqual(1024 * 1024);

  // The one-task loop above sees a single clock read, because the timer cannot fire inside it. So also read what
  // frame costs in real frames. Printed, not gated: this is the first seconds, while baseline code boxes doubles.
  // soak: gates the same reading once the JIT has warmed.
  await page.evaluate(() => { window.__audio!.live.setFrames(true); });
  await sleep(page, 1000);
  const cold = await sampleFrameCost(page, cdp, 5);
  console.log(`A25 cold real frames at ${cold.hz} Hz: frame() ${(cold.frameBytesPerS / 1024).toFixed(2)} KB/s, ${JSON.stringify(cold.parts)} B/s; the timer tick, which allocates notes by design, ${(cold.tickBytesPerS / 1024).toFixed(1)} KB/s`);
  await cdp.send('HeapProfiler.disable');
});

// ---- A25b ----

test.describe('guard', () => {
  test('guard: a throwing createOscillator in the tick does not propagate, warns once, goes inert', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('audio:')) warnings.push(m.text()); });
    await unlockLive(page, { sync: 16 });
    await page.evaluate(() => {
      const ctx = window.__audio!.live.probe().ctx!;
      (ctx as unknown as { createOscillator: () => never }).createOscillator = () => { throw new Error('forced'); };
    });
    await sleep(page, 1500);
    const s = await page.evaluate(() => window.__audio!.live.stats());
    console.log(`A25b tick: ${JSON.stringify({ disposed: s.disposed, state: s.state, timer: s.timerRunning })}, warnings ${warnings.length}`);
    expect(s.disposed).toBe(true);
    expect(s.timerRunning).toBe(false);
    expect(s.state).toBe('closed');
    expect(warnings).toHaveLength(1);
  });

  test('guard: a view with events null does not propagate, warns once, goes inert', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('audio:')) warnings.push(m.text()); });
    await unlockLive(page, { sync: 4 });
    const r = await page.evaluate(() => {
      const live = window.__audio!.live;
      let threw = false;
      const sim = { beat: 1000, sync: 4, mode: 1, speed: 80 };
      const zone = { index: 0, musicKey: 0 };
      try {
        live.frameRaw({ sim, zone, alpha: 0, reducedMotion: false, events: null });
        live.frameRaw({ sim, zone, alpha: 0, reducedMotion: false, events: null });
      } catch {
        threw = true;
      }
      return { threw, s: live.stats() };
    });
    await sleep(page, 200);
    const later = await page.evaluate(() => window.__audio!.live.stats());
    console.log(`A25b frame: threw ${r.threw}, disposed ${r.s.disposed}, state ${later.state}, warnings ${warnings.length}`);
    expect(r.threw).toBe(false);
    expect(r.s.disposed).toBe(true);
    expect(later.state).toBe('closed');
    expect(warnings).toHaveLength(1);
  });
});

// ---- A25c ----

test('soak: 300 s real time with stable sources, no late steps, and a flat heap', async ({ page }) => {
  test.skip(process.env['T07_SOAK'] !== '1', 'set T07_SOAK=1');
  test.setTimeout(420_000);
  await unlockLive(page, { sync: 16 });
  const cdp = await page.context().newCDPSession(page);
  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const samples: number[] = [];
  const started = Date.now();
  let at60 = 0;
  while (Date.now() - started < 300_000) {
    await sleep(page, 20_000);
    samples.push(await page.evaluate(() => window.__audio!.live.stats().liveSources));
    if (at60 === 0 && Date.now() - started >= 60_000) at60 = await heap();
  }
  const at300 = await heap();
  // §9.2: project code outside src/world, at most 128 B per frame. Read in bytes per second against a 60 Hz frame,
  // because this page runs rAF near 165 Hz, and frame reads the clock at the timer's rate, not the frame's.
  await cdp.send('HeapProfiler.enable');
  const warm = await sampleFrameCost(page, cdp, 5);
  await cdp.send('HeapProfiler.disable');
  console.log(`A25c warm real frames at ${warm.hz} Hz: frame() ${warm.frameBytesPerS.toFixed(0)} B/s, ${(warm.frameBytesPerS / 60).toFixed(0)} B per 60 Hz frame, ${JSON.stringify(warm.parts)}; the timer tick ${(warm.tickBytesPerS / 1024).toFixed(1)} KB/s`);
  expect(warm.frameBytesPerS / 60).toBeLessThanOrEqual(128);
  const s = await page.evaluate(() => window.__audio!.live.stats());
  console.log(`A25c sources ${samples.join(',')}; heap at 60 s ${(at60 / 1048576).toFixed(2)} MB, at 300 s ${(at300 / 1048576).toFixed(2)} MB; ${JSON.stringify(s)}`);
  expect(s.late).toBe(0);
  expect(s.skipped).toBe(0);
  expect(Math.max(...samples)).toBeLessThanOrEqual(96);
  expect(at300 - at60).toBeLessThanOrEqual(2 * 1048576);
});

// ---- A26 ----

test.describe('pictures', () => {
  test('look: spec-sync-ramp', async ({ page }, info) => {
    await open(page);
    await page.evaluate(async () => {
      const A = window.__audio!;
      const marks = Array.from({ length: 16 }, (_, i) => ({ t: A.startS + i * A.barS, label: `b${i}` }));
      await A.shot({
        kind: 'spec',
        title: '16 bars from section C, SYNC 1 rising to 16',
        scene: { bar0: 24, bars: 16, sync: (b) => 1 + Math.min(15, b), sector: 0, key: 0, tailS: 1 },
        t0: A.startS, t1: A.startS + 16 * A.barS, marks,
      });
    });
    await saveShot(page, info, 'spec-sync-ramp');
  });

  test('look: spec-sector', async ({ page }, info) => {
    await open(page);
    await page.evaluate(async () => {
      const A = window.__audio!;
      const marks = Array.from({ length: 13 }, (_, i) => ({ t: A.startS + i * A.barS, label: `b${i}` }));
      await A.shot({
        kind: 'spec',
        title: 'sector and key change requested at bar 6: fill bar 7, crash and new key at bar 8',
        scene: { bar0: 0, bars: 13, sync: 8, sector: (b) => (b < 6 ? 0 : 1), key: (b) => (b < 6 ? 0 : 7), tailS: 1 },
        t0: A.startS, t1: A.startS + 13 * A.barS, marks,
      });
    });
    await saveShot(page, info, 'spec-sector');
  });

  test('look: spec-hit', async ({ page }, info) => {
    await open(page);
    await page.evaluate(async () => {
      const A = window.__audio!;
      const hitT = A.startS + 2 * A.barS + 1.0;
      await A.shot({
        kind: 'spec',
        title: 'one hit at the mark, music only',
        scene: { bar0: 0, bars: 4, sync: 8, sector: 0, key: 0, volume: [1, 0], events: [{ bar: 2, step: 6, afterS: 0.1, kind: A.Ev.HIT, value: 2 }] },
        t0: hitT - 1.5, t1: hitT + 2, marks: [{ t: hitT, label: 'hit' }, { t: hitT + 0.4, label: '+400 ms' }],
      });
    });
    await saveShot(page, info, 'spec-hit');
  });

  test('look: wave-snare', async ({ page }, info) => {
    await open(page);
    await page.evaluate(async () => {
      await window.__audio!.shot({
        kind: 'wave', title: 'kit snare, linear amplitude', kitSound: 'snare', t0: 0, t1: 0.32,
        marks: [{ t: 0.2, label: 'gate starts' }, { t: 0.235, label: 'gate shut' }],
      });
    });
    await saveShot(page, info, 'wave-snare');
  });

  test('look: wave-pump', async ({ page }, info) => {
    await open(page);
    await page.evaluate(async (pad) => {
      const A = window.__audio!;
      const marks = [0, 4, 8, 12].map((s) => ({ t: A.startS + s * A.stepS, label: `kick ${s}` }));
      await A.shot({
        kind: 'wave', title: 'pad solo, one bar at SYNC 4',
        scene: { bar0: 0, bars: 2, sync: 4, sector: 0, key: 0, layers: [pad] },
        t0: A.startS, t1: A.startS + A.barS, marks,
      });
    }, Layer.PAD);
    await saveShot(page, info, 'wave-pump');
  });
});

// ---- A27 ----

test('listen: six WAVs by the download button, for the operator', async ({ page }, info) => {
  test.setTimeout(600_000);
  await open(page);
  const names = await page.evaluate(() => [...window.__audio!.presets]);
  expect(names).toEqual(['01-sync-ramp', '02-full-form-sync8', '03-sector-change', '04-play-with-events', '05-top-tier-sector3', '06-drums']);
  for (const name of names) {
    await page.selectOption('#preset', name);
    const pending = page.waitForEvent('download', { timeout: 300_000 });
    await page.click('#render');
    const download = await pending;
    const path = join(info.project.outputDir, `${name}.wav`);
    mkdirSync(dirname(path), { recursive: true });
    await download.saveAs(path);
    const bytes = readFileSync(path);
    const header = parseWavHeader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    console.log(`WAV ${path} ${(statSync(path).size / 1e6).toFixed(1)} MB ${JSON.stringify(header)}`);
    expect(header).not.toBeNull();
    expect(header!.channels).toBe(2);
    expect(header!.frames).toBeGreaterThan(48000);
  }
});

// Ev and SimMode are referenced only in page functions as A.Ev and A.SimMode. These keep the imports honest.
test('look: the event and mode ids the page exposes equal the contract', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({ Ev: window.__audio!.Ev, SimMode: window.__audio!.SimMode }));
  expect(r.Ev).toEqual(Ev);
  expect(r.SimMode).toEqual(SimMode);
});
