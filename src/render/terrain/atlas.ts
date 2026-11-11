// Pure, no three. Writes the height ring: one RGBA32F layout, 129 wide, 128 rows per level, R true height, G morph height.
// Rows are written in pairs, odd then even, so an odd row's morph value is always known (section 6.4).
import { CLIP_COLS, CLIP_LEVELS, CLIP_RING_ROWS, CLIP_ROWS, type Travel, type WorldSource } from '../../contracts/index';
import { baseRow, spacing } from './layout';

const W = CLIP_COLS + 1;

/** Cold path, kept out of writePair so the per-pair step builds no string. */
function noProgress(k: number, q: number): RangeError {
  return new RangeError(`terrain atlas: no progress at level ${k}, row ${q}: q + 2 rounds to q, past R1's exact range (DI-93)`);
}

/** Components per atlas row. */
export const ATLAS_ROW_COMPONENTS = W * 4;
export const ATLAS_WIDTH = W;
export const ATLAS_HEIGHT = CLIP_RING_ROWS * CLIP_LEVELS;

export class AtlasWriter {
  readonly data = new Float32Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  /** Highest even lattice row written, per level. */
  private readonly written = new Float64Array(CLIP_LEVELS).fill(-Infinity);
  /** Lowest lattice row still live in the ring, per level. */
  private readonly low = new Float64Array(CLIP_LEVELS).fill(Infinity);
  /** Heights of the last even row, per level. */
  private readonly prevEven: Float64Array[] = [];
  private readonly tmpOdd = new Float64Array(W);
  private readonly tmpEven = new Float64Array(W);
  private readonly world: WorldSource;

  constructor(world: WorldSource) {
    this.world = world;
    for (let k = 0; k < CLIP_LEVELS; k++) this.prevEven.push(new Float64Array(W));
  }

  needsRefill(cam: Readonly<Travel>): boolean {
    for (let k = 0; k < CLIP_LEVELS; k++) {
      const base = baseRow(k, cam);
      if (base + CLIP_ROWS - this.written[k]! > CLIP_RING_ROWS || base < this.low[k]!) return true;
    }
    return false;
  }

  /** Every level from pure state, with no range callback. */
  refill(cam: Readonly<Travel>): void {
    for (let k = 0; k < CLIP_LEVELS; k++) {
      const base = baseRow(k, cam);
      const start = base - 2;
      const prev = this.prevEven[k]!;
      this.evaluate(k, start, prev);
      this.writeEven(k, start, prev);
      this.written[k] = start;
      this.low[k] = start;
      const end = base + CLIP_ROWS;
      while (this.written[k]! < end) this.writePair(k, null);
    }
  }

  /** Only the rows crossed since the last call. onRow fires once per row written. Allocates nothing. */
  advance(cam: Readonly<Travel>, onRow: (atlasRow: number) => void): void {
    for (let k = 0; k < CLIP_LEVELS; k++) {
      const end = baseRow(k, cam) + CLIP_ROWS;
      while (this.written[k]! < end) this.writePair(k, onRow);
    }
  }

  private evaluate(k: number, q: number, out: Float64Array): void {
    const s = spacing(k);
    const world = this.world;
    for (let c = 0; c < W; c++) out[c] = world.height((c - 64) * s, q, s, 0);
  }

  /**
   * One pair step: evaluates even row q + 2, then odd row q + 1, so T01's one-row memo sees whole rows. It is the only step of the
   * refill and advance loops, so it throws, before writing, when the step would not move written[k]: from row 2^54, level 0 near chunk
   * 2^49, q + 2 rounds to q in a double and both loops would spin forever (DI-93). The throw reaches the loop's fatal route instead.
   */
  private writePair(k: number, onRow: ((atlasRow: number) => void) | null): void {
    const q = this.written[k]!;
    if (!(q + 2 > q)) throw noProgress(k, q);
    const lo = this.prevEven[k]!;
    const hi = this.tmpEven;
    const odd = this.tmpOdd;
    this.evaluate(k, q + 2, hi);
    this.evaluate(k, q + 1, odd);
    const oddRow = this.writeOdd(k, q + 1, odd, lo, hi);
    const evenRow = this.writeEven(k, q + 2, hi);
    lo.set(hi);
    const written = q + 2;
    this.written[k] = written;
    if (written - this.low[k]! >= CLIP_RING_ROWS) this.low[k] = written - (CLIP_RING_ROWS - 1);
    if (onRow) {
      onRow(oddRow);
      onRow(evenRow);
    }
  }

  private atlasRow(k: number, q: number): number {
    return ((q % CLIP_RING_ROWS) + CLIP_RING_ROWS) % CLIP_RING_ROWS + k * CLIP_RING_ROWS;
  }

  /** Even row: an odd column sits on the parent's horizontal edge, an even column is a parent vertex. */
  private writeEven(k: number, q: number, h: Float64Array): number {
    const row = this.atlasRow(k, q);
    const data = this.data;
    let at = row * ATLAS_ROW_COMPONENTS;
    for (let c = 0; c < W; c++, at += 4) {
      const v = h[c]!;
      data[at] = v;
      data[at + 1] = c % 2 === 1 ? 0.5 * (h[c - 1]! + h[c + 1]!) : v;
    }
    return row;
  }

  /** Odd row: an even column sits on the parent's vertical edge, an odd column on its uniform diagonal. */
  private writeOdd(k: number, q: number, h: Float64Array, lo: Float64Array, hi: Float64Array): number {
    const row = this.atlasRow(k, q);
    const data = this.data;
    let at = row * ATLAS_ROW_COMPONENTS;
    for (let c = 0; c < W; c++, at += 4) {
      data[at] = h[c]!;
      data[at + 1] = c % 2 === 0 ? 0.5 * (lo[c]! + hi[c]!) : 0.5 * (lo[c + 1]! + hi[c - 1]!);
    }
    return row;
  }
}
