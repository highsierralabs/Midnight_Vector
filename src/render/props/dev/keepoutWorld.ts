// Section 5.6 over the fake world, in T01's form: y + top * scale <= abs(x) / 4.8. A candidate scales down to fit, and is rejected
// if the scale would drop below 0.5. Floating objects and landmark rings are exempt. Exists only to measure the rule before T01 lands.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, FOG_END, PROP_STRIDE, PropField,
  type PropRow, type WorldSource,
} from '../../../contracts/index';
import { createPropRow } from '../../../core/alloc';

const C = 0.24;
const LIMIT_X = C * FOG_END;

export function createKeepoutWorld(base: WorldSource): WorldSource {
  const raw: PropRow = createPropRow();
  return {
    seed: base.seed,
    height: (x, iz, zs, zLocal) => base.height(x, iz, zs, zLocal),
    fillItems: (c, out) => base.fillItems(c, out),
    zoneAt: (at, out) => base.zoneAt(at, out),
    bendAt: (at, out) => base.bendAt(at, out),
    fillProps(chunk: number, out: PropRow): void {
      base.fillProps(chunk, raw);
      out.chunk = chunk;
      let n = 0;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        out.start[a] = n;
        const spec = ARCHETYPE_SPEC[a]!;
        for (let i = raw.start[a]!; i < raw.start[a + 1]!; i++) {
          const from = i * PROP_STRIDE;
          const x = raw.data[from + PropField.X]!;
          const y = raw.data[from + PropField.Y]!;
          let scale = raw.data[from + PropField.SCALE]!;
          if (!spec.floats && a !== Archetype.RING && a !== Archetype.SEARCHLIGHT && Math.abs(x) < LIMIT_X) {
            const room = Math.abs(x) / 4.8 - y;
            const fit = room / spec.top;
            if (fit < 0.5) continue;
            if (fit < scale) scale = fit;
          }
          const to = n * PROP_STRIDE;
          for (let k = 0; k < PROP_STRIDE; k++) out.data[to + k] = raw.data[from + k]!;
          out.data[to + PropField.SCALE] = scale;
          n++;
        }
      }
      out.start[ARCHETYPE_COUNT] = n;
    },
  };
}
