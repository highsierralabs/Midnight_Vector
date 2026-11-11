// Temporal measurement inside the page (plan M6 and the Decision log: temporal in the page, stills in Node).
// runSequence is serialised into page.evaluate, so it is self-contained: it refers to nothing outside its own body
// except window.__mv. Each frame is renderAt plus pixels() in the same task. Rows are counted top-down here, and the
// bottom-up buffer is indexed accordingly. metrics.spec runs the same function in Node against a fake __mv, so its
// sparkle and frame-difference arithmetic is checked against metrics.ts's pure forms.
import type { FeelState, LayerName, PostVariant } from '../../../src/contracts/index';

export interface SeqArgs {
  chunk: number; local: number; tick: number;
  frames: number; du: number; dticks: number;
  post: PostVariant; layers: [LayerName, boolean][]; feel: Partial<FeelState> | null;
  /** Top-down row ranges [y0, y1). */
  sparkleBands: [number, number][];
  diffBands: [number, number][];
  thresh: number;
  /** Per-pixel mean abs(dL) and sparkle count over the run, as an RGBA image: R sparkle, G dL, both times heatGain. */
  heat: boolean; heatGain: number;
  /** Top-down rows and columns recorded every frame, for slit scans. */
  slitRows: number[]; slitCols: number[];
  /** 64 x 36 block means each frame, for X2. */
  blocks: boolean;
  /** Every k frames, whole-frame chroma, lit saturation, luma and near-white; 0 for none. */
  curvesEvery: number;
  /** Crops [x0, y0, x1, y1] at frames stripAt .. stripAt + stripCount - 1. */
  stripBox: [number, number, number, number] | null; stripAt: number; stripCount: number;
  /** Whole frames returned as base64, top-down RGBA. */
  keepFramesAt: number[];
}

export interface SeqResult {
  frames: number; w: number; h: number; msTotal: number; msP50: number;
  sparkle: number[]; diff: number[];
  heat: string | null;
  slitRows: string[]; slitCols: string[];
  meanLuma: number[]; maxMeanStep: number; maxMeanStepAt: number; blockStepP999: number; blockStepMax: number;
  curves: { frame: number; chroma: number; litSat: number; luma: number; nearWhite: number }[];
  strips: string[];
  kept: { frame: number; b64: string }[];
  ends: { chunk: number; local: number; tick: number }[];
}

export function runSequence(a: SeqArgs): SeqResult {
  const mv = (window as unknown as { __mv: { setPost(v: string): void; setLayerVisible(n: string, on: boolean): void; forceFeel(o: unknown): void; renderAt(c: number, l: number, t: number): number; pixels(): Uint8Array; stats(): { width: number; height: number } } }).__mv;
  function b64(u8: Uint8Array): string {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[]);
    return btoa(s);
  }
  mv.setPost(a.post);
  for (const [n, on] of a.layers) mv.setLayerVisible(n, on);
  mv.forceFeel(a.feel);

  let w = 0, h = 0;
  // Luma of frames t - 2 and t - 1, and a spare buffer reused for frame t.
  let bufOld: Float32Array | null = null, bufPrev: Float32Array | null = null, spare: Float32Array | null = null;
  const spHit = a.sparkleBands.map(() => 0), spN = a.sparkleBands.map(() => 0);
  const dfSum = a.diffBands.map(() => 0), dfN = a.diffBands.map(() => 0);
  let heatD: Float32Array | null = null, heatS: Float32Array | null = null;
  let slitR: Uint8Array[] = [], slitC: Uint8Array[] = [];
  const meanLuma: number[] = [];
  let prevBlocks: Float64Array | null = null;
  const HB = 25600;   // histogram of block steps in .01 bins up to 256
  const hist = new Float64Array(HB);
  let blockSteps = 0, blockStepMax = 0;
  const curves: SeqResult['curves'] = [];
  const strips: string[] = [];
  const kept: SeqResult['kept'] = [];
  const ends: SeqResult['ends'] = [];
  const msList: number[] = [];
  let msTotal = 0;
  const needLuma = a.sparkleBands.length > 0 || a.diffBands.length > 0 || a.heat;

  for (let f = 0; f < a.frames; f++) {
    const total = a.local + f * a.du;
    const k = Math.floor(total / 64);
    const chunk = a.chunk + k;
    const local = total - 64 * k;
    const tick = a.tick + f * a.dticks;
    if (f === 0 || f === a.frames - 1) ends.push({ chunk, local, tick });
    const ms = mv.renderAt(chunk, local, tick);
    msTotal += ms;
    msList.push(ms);
    const px = mv.pixels();
    if (f === 0) {
      // stats().width and height are the drawing buffer, the shape of pixels() (section 8.1).
      const st = mv.stats();
      w = st.width;
      h = st.height;
      if (a.heat) { heatD = new Float32Array(w * h); heatS = new Float32Array(w * h); }
      slitR = a.slitRows.map(() => new Uint8Array(w * a.frames * 4));
      slitC = a.slitCols.map(() => new Uint8Array(h * a.frames * 4));
    }
    const rowOff = (y: number): number => (h - 1 - y) * w * 4;

    let L: Float32Array | null = null;
    if (needLuma) {
      L = spare && spare.length === w * h ? spare : new Float32Array(w * h);
      spare = null;
      for (let y = 0; y < h; y++) {
        let i = rowOff(y);
        let p = y * w;
        for (let x = 0; x < w; x++, i += 4, p++) L[p] = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      }
    }
    if (L && bufPrev) {
      const prev1 = bufPrev;
      for (let b = 0; b < a.diffBands.length; b++) {
        const [y0, y1] = a.diffBands[b]!;
        let s = 0;
        for (let p = y0 * w; p < y1 * w; p++) s += Math.abs(L[p]! - prev1[p]!);
        dfSum[b]! += s;
        dfN[b]! += (y1 - y0) * w;
      }
      if (heatD) for (let p = 0; p < w * h; p++) heatD[p]! += Math.abs(L[p]! - prev1[p]!);
    }
    if (L && bufPrev && bufOld) {
      // Second difference at t = f - 1 uses frames f - 2 (bufOld), f - 1 (bufPrev) and f (L).
      const old = bufOld, prev1 = bufPrev;
      for (let b = 0; b < a.sparkleBands.length; b++) {
        const [y0, y1] = a.sparkleBands[b]!;
        let hit = 0;
        for (let p = y0 * w; p < y1 * w; p++) if (Math.abs(L[p]! - 2 * prev1[p]! + old[p]!) > a.thresh) hit++;
        spHit[b]! += hit;
        spN[b]! += (y1 - y0) * w;
      }
      if (heatS) for (let p = 0; p < w * h; p++) if (Math.abs(L[p]! - 2 * prev1[p]! + old[p]!) > a.thresh) heatS[p]! += 1;
    }
    // Rotate: the oldest buffer is reused for the next frame's luma.
    if (L) { spare = bufOld; bufOld = bufPrev; bufPrev = L; }

    for (let r = 0; r < a.slitRows.length; r++) {
      const y = a.slitRows[r]!;
      slitR[r]!.set(px.subarray(rowOff(y), rowOff(y) + w * 4), f * w * 4);
    }
    for (let c = 0; c < a.slitCols.length; c++) {
      const x = a.slitCols[c]!;
      const dst = slitC[c]!;
      // A column image is frames wide and h tall: pixel (f, y).
      for (let y = 0; y < h; y++) {
        const i = rowOff(y) + x * 4, o = (y * a.frames + f) * 4;
        dst[o] = px[i]!; dst[o + 1] = px[i + 1]!; dst[o + 2] = px[i + 2]!; dst[o + 3] = 255;
      }
    }
    if (a.blocks) {
      const BW = 64, BH = 36;
      const bm = new Float64Array(BW * BH), bc = new Float64Array(BW * BH);
      let sum = 0;
      for (let y = 0; y < h; y++) {
        const by = Math.min(BH - 1, Math.floor((y * BH) / h));
        let i = rowOff(y);
        for (let x = 0; x < w; x++, i += 4) {
          const bx = Math.min(BW - 1, Math.floor((x * BW) / w));
          const l = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
          bm[by * BW + bx]! += l;
          bc[by * BW + bx]! += 1;
          sum += l;
        }
      }
      for (let q = 0; q < bm.length; q++) bm[q] = bm[q]! / bc[q]!;
      meanLuma.push(sum / (w * h));
      if (prevBlocks) {
        for (let q = 0; q < bm.length; q++) {
          const d = Math.abs(bm[q]! - prevBlocks[q]!);
          hist[Math.min(HB - 1, Math.floor(d * 100))]! += 1;
          blockSteps++;
          if (d > blockStepMax) blockStepMax = d;
        }
      }
      prevBlocks = bm;
    }
    if (a.curvesEvery > 0 && f % a.curvesEvery === 0) {
      let chroma = 0, sat = 0, satN = 0, lum = 0, white = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        chroma += hi - lo;
        if (hi >= 32) { sat += (hi - lo) / hi; satN++; }
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lo > 235) white++;
      }
      const n = w * h;
      curves.push({ frame: f, chroma: chroma / n, litSat: satN ? sat / satN : 0, luma: lum / n, nearWhite: (100 * white) / n });
    }
    if (a.stripBox && f >= a.stripAt && f < a.stripAt + a.stripCount) {
      const [x0, y0, x1, y1] = a.stripBox;
      const cw = x1 - x0, ch = y1 - y0;
      const out = new Uint8Array(cw * ch * 4);
      for (let y = 0; y < ch; y++) out.set(px.subarray(rowOff(y0 + y) + x0 * 4, rowOff(y0 + y) + x1 * 4), y * cw * 4);
      strips.push(b64(out));
    }
    if (a.keepFramesAt.includes(f)) {
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) out.set(px.subarray(rowOff(y), rowOff(y) + w * 4), y * w * 4);
      kept.push({ frame: f, b64: b64(out) });
    }
  }

  let maxMeanStep = 0, maxMeanStepAt = -1;
  for (let f = 1; f < meanLuma.length; f++) {
    const d = Math.abs(meanLuma[f]! - meanLuma[f - 1]!);
    if (d > maxMeanStep) { maxMeanStep = d; maxMeanStepAt = f; }
  }
  let blockStepP999 = 0;
  if (blockSteps > 0) {
    const want = Math.ceil(0.999 * blockSteps);
    let acc = 0;
    for (let q = 0; q < HB; q++) { acc += hist[q]!; if (acc >= want) { blockStepP999 = (q + 1) / 100; break; } }
  }
  let heat: string | null = null;
  if (heatD && heatS) {
    const out = new Uint8Array(w * h * 4);
    const pairs = Math.max(1, a.frames - 1), triples = Math.max(1, a.frames - 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, o = p * 4;
        out[o] = Math.min(255, Math.round((heatS[p]! / triples) * 255 * a.heatGain));
        out[o + 1] = Math.min(255, Math.round((heatD[p]! / pairs) * a.heatGain));
        out[o + 2] = 0;
        out[o + 3] = 255;
      }
    }
    heat = b64(out);
  }
  msList.sort((x, y) => x - y);
  return {
    frames: a.frames, w, h, msTotal, msP50: msList[Math.floor(msList.length / 2)] ?? 0,
    sparkle: spHit.map((v, i) => (spN[i]! > 0 ? v / spN[i]! : 0)),
    diff: dfSum.map((v, i) => (dfN[i]! > 0 ? v / dfN[i]! : 0)),
    heat,
    slitRows: slitR.map((u) => b64(u)), slitCols: slitC.map((u) => b64(u)),
    meanLuma, maxMeanStep, maxMeanStepAt, blockStepP999, blockStepMax,
    curves, strips, kept, ends,
  };
}
