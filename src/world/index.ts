// src/world/index.ts -- the world's only factory. Every other module sees it through WorldSource.
import type { WorldOptions, WorldSource } from '../contracts/index';
import { KEEPOUT_K, PLACE, QUOTA, SAG } from './biomes';
import { createHeight } from './height';
import { createItems } from './items';
import { createNoise } from './noise';
import { createScatter } from './scatter';
import { createZones } from './zones';

/** Throws RangeError on a non-integer seed, or on a periodChunks that is negative, non-integer or not a multiple of 8 (section 4.4 needs period * 64 / 512 integral). */
export function createWorld(o: WorldOptions): WorldSource {
  const { seed, periodChunks } = o;
  if (!Number.isInteger(seed)) throw new RangeError(`createWorld: seed must be an integer, got ${seed}`);
  if (!Number.isInteger(periodChunks) || periodChunks < 0 || periodChunks % 8 !== 0) {
    throw new RangeError(`createWorld: periodChunks must be a non-negative multiple of 8, got ${periodChunks}`);
  }
  const noise = createNoise(seed, periodChunks);
  const zones = createZones(seed, periodChunks);
  const height = createHeight(noise, zones, periodChunks);
  const fillProps = createScatter(seed, periodChunks, { quota: QUOTA, place: PLACE, sag: SAG, keepoutK: KEEPOUT_K }, height, zones);
  const fillItems = createItems(seed, periodChunks, zones);
  return {
    seed,
    height: height.at,
    fillProps,
    fillItems,
    zoneAt: zones.zoneAt,
    bendAt: zones.bendAt,
  };
}
