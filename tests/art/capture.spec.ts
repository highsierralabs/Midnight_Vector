// A2, A2n, A3: the instruments tell the truth on the real page (plan M1, "Truth checks in capture.spec").
import { test, expect } from '../support/pw';
import { buildCombos, opening, ringAhead } from './support/combos';
import { ART_SEED, frame, goto, openHarness, pageZone, at } from './support/capture';
import { blockMeans } from './support/metrics';
import { decodePng } from './support/png';
import { roundFile, writeRoundText } from './support/round';
import { readFileSync, writeFileSync } from 'node:fs';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);

function blockDiff(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const A = blockMeans(w, h, a), B = blockMeans(w, h, b);
  let s = 0;
  for (let k = 0; k < A.length; k++) s += Math.abs(A[k]! - B[k]!);
  return s / A.length;
}

function byteDiff(a: Uint8Array, b: Uint8Array): { bytes: number; max: number } {
  let bytes = 0, max = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { bytes++; if (d > max) max = d; } }
  return { bytes, max };
}

test.describe('A3 combos, in Node', () => {
  test('36 distinct pairs, labels from Node match, 30 transitions, deterministic, no ring ahead', () => {
    const c1 = buildCombos(SEED);
    const c2 = buildCombos(SEED);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
    const keys = new Set(c1.pairs.map((p) => `${p.palette}:${p.biome}`));
    expect(keys.size).toBe(36);
    for (const p of c1.pairs) expect(p.z0).toBeGreaterThanOrEqual(0);
    expect(c1.samples.length).toBe(180);
    expect(c1.transitions.length).toBe(30);
    expect(new Set(c1.transitions.map((t) => `${t.a}>${t.b}`)).size).toBe(30);
    for (const s of c1.samples) {
      expect(ringAhead(s.chunk), `${s.id} has a RING within 8 chunks`).toBe(false);
      expect(s.into).toBeGreaterThanOrEqual(0);
      expect(s.into).toBeLessThanOrEqual(74);
    }
    expect(c1.day.length).toBe(12);
    const open = opening(SEED, 4);
    const lines = [
      `seed ${SEED}: all 36 pairs by zone ${c1.allPairsByZone}; transitions by zone ${Math.max(...c1.transitions.map((t) => t.zone)) + 1}`,
      ...open.map((o) => `zone ${o.zone}: palette ${o.palette} biome ${o.biome} hero ${o.hero} dayPhase ${o.dayPhase.toFixed(3)}`),
      ...c1.pairs.map((p) => `pair p${p.palette} b${p.biome}: zone ${p.z0 / 100}, tile ${p.tile.chunk}/${p.tile.local} into ${p.tile.into} dayPhase ${p.tile.dayPhase.toFixed(3)}`),
      ...c1.day.map((d) => `day ${d.id}: ${d.chunk}/${d.local} biome ${d.biome} dayPhase ${d.dayPhase.toFixed(4)}`),
      ...c1.transitions.map((t) => `trans ${t.a}>${t.b}: zone ${t.zone} biomes ${t.biomeA}>${t.biomeB} heroes ${t.heroA}>${t.heroB}`),
    ];
    writeRoundText(`combos-seed${SEED}.txt`, `${lines.join('\n')}\n`);
    console.log(lines.slice(0, 5).join('\n'));
    console.log(`samples=${c1.samples.length} pairs=${c1.pairs.length} transitions=${c1.transitions.length}`);
  });
});

test.describe('A2 truth on the real page', () => {
  test.setTimeout(300_000);

  test('row order, size, alpha, tier, warp, page labels, aperiodic world', async ({ page }, info) => {
    const combos = buildCombos(SEED);
    const o = await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
    console.log(`A2 renderer ${o.renderer}; boot first frame ${o.firstFrameMs.toFixed(0)} ms`);
    const stats = await page.evaluate(() => window.__mv!.stats());
    expect(stats.tier).toBe(3);
    expect([stats.width, stats.height]).toEqual([1920, 1080]);

    // Every sample's label from the page's own zone equals the request.
    const wrong: string[] = [];
    for (const s of [...combos.samples, ...combos.day]) {
      const z = await pageZone(page, s.chunk, s.local);
      if (z.paletteA !== s.palette || z.biomeA !== s.biome || z.paletteMix !== 0) wrong.push(`${s.id}: page ${z.paletteA}/${z.biomeA} mix ${z.paletteMix}`);
    }
    for (const t of combos.transitions) {
      const z = await pageZone(page, t.mid.chunk, t.mid.local);
      if (z.paletteA !== t.a || Math.abs(z.paletteMix - 0.5) > 0.02) wrong.push(`${t.mid.id}: page ${z.paletteA} mix ${z.paletteMix}`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);

    // Warp, then stats().chunk equals the request (goto asserts it), then the raw read.
    const s0 = combos.pairs[0]!.tile;
    await goto(page, s0);
    const raw = await frame(page, s0, {}, true);
    expect(raw.w).toBe(1920);
    expect(raw.h).toBe(1080);
    let alphaBad = 0;
    for (let i = 3; i < raw.rgba.length; i += 4) if (raw.rgba[i] !== 255) alphaBad++;
    expect(alphaBad).toBe(0);
    // Rows arrive bottom-up: flipped, they match a screenshot of the same frame far better than unflipped.
    const shotPath = info.outputPath('a2-screenshot.png');
    await page.screenshot({ path: shotPath });
    const shot = decodePng(readFileSync(shotPath));
    expect([shot.w, shot.h]).toEqual([1920, 1080]);
    const flipped = new Uint8Array(raw.rgba.length);
    for (let y = 0; y < 1080; y++) flipped.set(raw.rgba.subarray((1079 - y) * 1920 * 4, (1080 - y) * 1920 * 4), y * 1920 * 4);
    const dFlip = blockDiff(flipped, shot.rgba, 1920, 1080), dRaw = blockDiff(raw.rgba, shot.rgba, 1920, 1080);
    console.log(`A2 block difference against the screenshot: flipped ${dFlip.toFixed(3)}, unflipped ${dRaw.toFixed(3)}`);
    expect(dFlip).toBeLessThan(dRaw / 2);

    // Aperiodic: the same tick at c and c + 1024 gives a different frame.
    const a = await frame(page, s0, {});
    const far = { ...s0, chunk: s0.chunk + 1024 };
    await goto(page, far);
    const b = await frame(page, far, {});
    const d = byteDiff(a.rgba, b.rgba);
    console.log(`A2 aperiodic: c ${s0.chunk} and c + 1024 at tick ${s0.tick} differ in ${d.bytes} bytes, max ${d.max}`);
    expect(d.bytes).toBeGreaterThan(100_000);
    writeFileSync(roundFile('capture-a2.txt'), `renderer ${o.renderer}\nflip ${dFlip} raw ${dRaw}\naperiodic bytes ${d.bytes} max ${d.max}\n`);
    console.log(`samples=${combos.samples.length} pairs=${combos.pairs.length} transitions=${combos.transitions.length}`);
  });

  test('A2n: on the default periodic world the truth check reports failure', async ({ page }, info) => {
    const combos = buildCombos(SEED);
    await openHarness(page, info, { seed: SEED, tier: 3 }, `/?harness&tier=3&seed=${SEED}`);
    let mismatched = 0;
    for (const s of combos.samples) {
      const z = await pageZone(page, s.chunk, s.local);
      if (z.paletteA !== s.palette || z.biomeA !== s.biome) mismatched++;
    }
    console.log(`A2n periodic world: ${mismatched} of ${combos.samples.length} sample labels differ from the request`);
    expect(mismatched).toBeGreaterThan(0);
    // Same state modulo the period: identical within DI-58's bound, at MSAA 0 (DI-67).
    await page.evaluate(() => window.__mv!.setMsaa(0));
    const c = at(320, 20, 3000);
    await goto(page, c);
    const a = await frame(page, c, {});
    const c2 = { ...c, chunk: c.chunk + 1024 };
    await goto(page, c2);
    const b = await frame(page, c2, {});
    const d = byteDiff(a.rgba, b.rgba);
    console.log(`A2n periodic: c 320 and c + 1024 at one tick differ in ${d.bytes} bytes, max ${d.max}`);
    expect(d.bytes).toBeLessThanOrEqual(64);
    expect(d.max).toBeLessThanOrEqual(1);
  });
});
