---
id: T01-world
title: World - noise, height, zones, palettes, biomes, scatter, keep-out, grounding, items
status: done
owner: T01 executor
depends_on: [T00]
owns: [src/world/**, tests/unit/world/**, plans/T01-world.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**, src/testing/**, plans/T00-foundation.md]
updated: 2026-11-12T18:04Z
---

## 1. Purpose

After T01, `createWorld({ seed, periodChunks })` is a real, pure, allocation-free `WorldSource`. What a viewer or a test can observe:

1. **The world never goes flat or repeats.** Every noise octave and the full height function stay non-flat at 1e9, 1e12 and 1e15 u, with tests that fail on the exact bug classes that make this go wrong (§4.4).
2. **It is full of stuff in every biome.** At any camera position in any of the six biomes, over 700 objects are live inside their draw distance, every one of 16 screen columns holds objects taller than 8 px at 1080p, and the six biomes are recognisably different silhouette sets. Ring capacity in §6.5 is never exceeded.
3. **The sun stays framed.** Outside Cyber Canyon, terrain plus grounded objects cover at most 10% of the visible disc in a CPU projection, and turning the keep-out off visibly fails that metric.
4. **Objects sit on the ground.** No grounded object floats above the surface the clipmap will actually draw at its `maxDist`, per the §5.7 gate.
5. **Same inputs, same bytes.** Any call order, any prior contents of the output row, two instances side by side, and `periodChunks = 1024` repetition at 2^37 periods all give byte-identical rows.
6. **Cheap enough.** `fillProps` runs at p50 at or below 60 us and p99 at or below 150 us on this machine in Node, allocates under 4 bytes per call, and a full refill of 96 prop rows plus 768 height rows stays under 25 ms.

T02 and T05 can consume every field of every record from section 4 alone, without asking what a field means.

## 2. Context and orientation

Working directory for every command: `C:\highsierralabs\terrain`. `§n` means a section of `architecture.md`. Read §4.4, §5, §6.5, §6.8, §8.1 and the T00 plan's section 4 first.

Terms:

- **Row:** the records of one chunk, 64 u long. `PropRow` and `ItemRow` are caller-owned and overwritten by `fillProps` and `fillItems`.
- **Grounded / floating:** a grounded archetype's mesh origin is its ground contact. A floating archetype's origin is its centre.
- **Sink:** how far a grounded object is lowered below true height so that coarse clipmap levels cannot show it floating (§5.7).
- **Root:** mesh geometry below the origin, buried at scale 1.
- **Keep-out:** the §5.6 rule that keeps object tops under the disc's lower part.
- **Fade:** the last 25 chunks of a zone, where palette, biome and hero crossfade to the next zone's values.
- **Impostor preview:** a CPU-drawn PNG, written by a test, showing terrain as a height-field and props as coloured outlines. It is not the game's renderer. It exists because §12 gives T01 no `dev/` page and no GPU path.
- **Mutant:** a deliberately broken copy of a noise function, kept in tests, proving a metric can fail.

**Where the `[O]` values come from.** Every `[O]` below was run on 2026-11-05 in throwaway JavaScript in the session scratchpad, on Node 24.14.1 and the Ryzen 3900X, using §4.4's noise text and T00's `hash01` text (it reproduced all 9 of T00's goldens by `===`). That code is not part of the project and may be gone, so none of it counts as acceptance. The rehearsal covered noise, biome height, zones, single-biome scatter and the impostor view. It did **not** cover scatter during a fade, or `fillItems` beyond the shard lattice arithmetic. Treat those as design [A] until section 7 passes. No GPU was involved in any of it.

**Sibling plans.** All twelve plans were compared by topic in `plans/RECONCILIATION.md`, and the seams below reflect its decisions. Where a seam row and §8 differ, §8 wins.

Environment: `src/world/**` may import only `src/contracts` and `src/core`. T00's lint bans `three`, `Math.random`, `Date.now` and `performance.now` there. Tests under `tests/unit/world/**` may import `src/world/*`, `src/core`, `src/contracts`, `src/testing` and `node:*`. There are no browser tests in this task, so port 5101 is unused and no Playwright output folder is needed. Generated files go under `test-results/T01/`, which is gitignored.

## 3. Scope

**Owned, complete file list:**

| Path | Contents |
|---|---|
| `src/world/index.ts` | `createWorld`, the only factory, validates options and composes the rest |
| `src/world/noise.ts` | §4.4 lattice noise, seeded gradient table, `ridged` (the octave loop inlined, with a per-row cache) |
| `src/world/draws.ts` | `hash01`'s arithmetic inlined, for several draws from one key without boxing. Added during the build, see section 11 |
| `src/world/height.ts` | §5.2 height, biome crossfade, one-entry row memo, `heightWith` |
| `src/world/zones.ts` | Permutations, `zoneAt`, `bendAt`, `findZoneChunk` |
| `src/world/palettes.ts` | §6.8 tables, sRGB to linear, OKLCh mix, `writePalette`. T11 may tune |
| `src/world/biomes.ts` | Every look-tunable number: terrain params, quotas, placement rules, `SAG`, `KEEPOUT_K`. T11 may tune |
| `src/world/keepout.ts` | §5.6 scale fit |
| `src/world/grounding.ts` | `levelAt`, sag lookup, coarse surface, §5.7 gate |
| `src/world/scatter.ts` | `createScatter`, `fillProps` |
| `src/world/lanes.ts` | Pure gate lane `laneX` |
| `src/world/items.ts` | `createItems`, `fillItems` |
| `tests/unit/world/*.test.ts` | `noise`, `draws`, `height`, `zones`, `palettes`, `purity`, `scatter`, `density`, `keepout`, `grounding`, `items`, `perf`, `preview` |
| `tests/unit/world/support/` | `mutants.ts`, `rows.ts`, `metrics.ts`, `frozenTable.ts`, `impostor.ts`, `png.ts`, `alloc.ts`, `worlds.ts` |
| `plans/T01-world.md` | This plan |

**Read-only:** `architecture.md`, `Agents.md`, `src/contracts/**`, `src/core/**`, `src/testing/**`, other plans.

**Non-goals:** meshes, shaders or any draw code (T05, T03). Collision and scoring rules (T02). Atlas layout and morph formula (T03). Real GPU screenshots of this world, which first exist at T10 and T11. Hero disc modes 1 to 3 (T04). Cross-browser bit-exactness (§5.1). A `dev/` page, because §12 does not grant one.

## 4. Interfaces

**Consumed:** from `src/contracts/index.ts`: `WorldSource`, `WorldOptions`, `PropRow`, `ItemRow`, `ZoneState`, `BendState`, `Travel`, `HeroMode`, `Objective`, `Archetype`, `ItemKind`, `ARCHETYPE_COUNT`, `CHUNK_LEN`, `PROP_STRIDE`, `ITEM_STRIDE`, `MAX_PROPS_PER_CHUNK`, `MAX_ITEMS_PER_CHUNK`, `ZONE_CHUNKS`, `ZONE_FADE_CHUNKS`, `PALETTE_FLOATS`, `PALETTE_COUNT`, `BIOME_COUNT`, `DAY_CHUNKS`, `VALLEY_HALF`, `ROAD_HALF`, `PLAY_HALF_X`, `PLAY_Y_MIN`, `PLAY_Y_MAX`, `CLIP_LEVELS`, `CLIP_BASE_SPACING`, `CLIP_COLS`, `CLIP_ROWS`, `CLIP_REAR_ROWS`, `CLIP_DROP`, `FOG_END`, `CAMERA_FOV`, `CAMERA_Y`, `CAMERA_PITCH`, `WORLD_PERIOD`, `ARCHETYPE_SPEC`, `ITEM_SPEC`, `PropField`, `ItemField`, `TRAFFIC_TRAVEL_MAX`, `TRAFFIC_FADE`, `ITEM_WINDOW_BEHIND`, `Biome`, `PaletteId`. From `src/core`: `hash01` (exact text in T00's plan), `travelMod`.

**Provided:**

```ts
// src/world/index.ts -- matches CreateWorld in §8.1. Throws RangeError on a non-integer seed, or on a
// periodChunks that is negative, non-integer or not a multiple of 8 (§4.4 needs period * 64 / 512 integral).
export function createWorld(o: WorldOptions): WorldSource;

// For src/app only; siblings still see the world only through WorldSource (see the T09, T10, T11 seams).
// src/world/palettes.ts
export function writePalette(index: number, out: Float32Array): void;      // PALETTE_FLOATS, linear, unmixed
// src/world/zones.ts
/** First chunk of the lowest zone with this palette and biome as its A values, or -1 if none in 4096 zones. Pure, allocates nothing, not for per-frame use. */
export function findZoneChunk(seed: number, palette: number, biome: number): number;
```

**Input domain, all functions.** `chunk` and `iz` are integer-valued and may be negative (rows behind the camera at chunk 0). Valid to `chunk < 2^48` and `iz < 2^53`, which covers rows ahead of the camera at `CHUNK_LIMIT - 1` (§4.2). `out.chunk` is set to the `chunk` argument unchanged, never the reduced value, so `rowMod(out.chunk)` stays right under `periodChunks`.

### PropRow records

Rows are sorted by archetype. Instances of `a` are `start[a] .. start[a + 1] - 1`, `start[ARCHETYPE_COUNT]` is the total, and records past the total are zero. Within an archetype, `zLocal` is non-decreasing. No row ever holds more of archetype `a` than `ARCHETYPE_SPEC[a].perChunk`, so §6.5's ring capacity formula is safe.

| Field | Offset | Meaning, for every archetype |
|---|---|---|
| `x` | 0 | Render-space lateral position of the mesh origin, u. Positive is the right side of the road when flying forward. Never a chunk-derived value |
| `y` | 1 | World y of the mesh origin, u. Grounded: `true height - sink`, and exactly 0 at `abs(x) <= 85`. Floating: `true height + hover`, the object's centre |
| `zLocal` | 2 | Forward distance from the start of the chunk, u, in `[0, 63.99999]` after Float32 storage. Forward distance from the camera is `(chunk - cam.chunk) * 64 + zLocal - cam.local`, render z is its negative |
| `yaw` | 3 | Radians about +y, three's sense: local +z maps to `(sin yaw, 0, cos yaw)`. Yaw 0 faces the approaching camera |
| `scale` | 4 | Uniform mesh multiplier, > 0. At scale 1 the mesh reaches `ARCHETYPE_SPEC[a].top` above its origin and `.root` below |
| `keep` | 5 | In `[0, 1)`. Instance is drawn while T05's ring keep, `keep` or higher (DI-41), is under `uDensity`. A golden-ratio sequence per archetype per row, so thinning is even inside each row, not clumped |
| `tintSeed` | 6 | Uniform in `[0, 1)`, for T05's accent choice |
| `variant` | 7 | Uniform in `[0, 1)`, except PYLON; consumer computes `floor(variant * n)` with its own `n` |

Per archetype. `top`, `root`, per chunk and `maxDist` are `ARCHETYPE_SPEC` (§8.1), and `top` and `root` are u at scale 1, which T05 builds to. All `top`, `root`, scale, band and hover values are [A].

| # | Archetype | Per chunk | maxDist | top / root | Type | Scale | `abs(x)` bands, weight | `y` | `yaw` | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | PALM | 10 | 1600 | 14 / 1.5 | grounded | .7-1.25 | 50-84 .7, 86-240 .3 | ground | uniform `[0, TAU)` | |
| 1 | ARCOLOGY | 6 | 4000 | 50 / 20 | grounded, tall | .5-3.2 | 120-520 .35, 1040-1800 .65 | ground | uniform `[-.35, .35]` | Keep-out scales near ones down to about 25 u; far ones reach 160 u |
| 2 | PYRAMID | 2 | 4000 | 40 / 20 | grounded, tall | .5-3.5 | 150-500 .3, 1040-1800 .7 | ground | uniform `[0, TAU)` | |
| 3 | ORB | 3 | 1200 | 3.5 / 0 | floating | .8-2.2 | 50-180 | height + hover 3-10 | uniform `[0, TAU)` | `top` is the radius at scale 1 |
| 4 | COLONNADE | 6 | 1600 | 12 / 1.5 | grounded | .7-1.3 | 50-84 .7, 86-320 .3 | ground | uniform `[0, TAU)` | |
| 5 | BILLBOARD | 3 | 1600 | 12 / 4 | grounded | .7-1.3 | 50-84 .6, 86-220 .4 | ground | facing | |
| 6 | PYLON | 2 | 3000 | 20 / 3 | grounded, line | 1 | exactly 100 | exactly 0 | exactly 0 | Row has 0 or 2: left first, then right. `zLocal = 0`. `keep = .1` left, `.6` right, so tier 1 keeps the left line whole and tier 0 drops both, matching T05's per-row clamp. `variant` .75 when the next row has a pair, otherwise .25, so a line that stops has no wire. Terrain at 100 is .5 u or less on default ground and p95 4.2 u in Canyon [O], never below 0, so y = 0 can be buried a little but cannot float. The coarse surface at its 3000 u reach (spacing 128) covers more than .7 of the mast in 163 of 4000 Canyon records and in none elsewhere [O: repair R1, section 10]; a fixed line is not rejected for that. Fits the keep-out, 100 / 4.8 = 20.8 |
| 7 | REFLECTOR | 32 | 800 | 1 / .3 | grounded, line | 1 | exactly 44.5 | exactly 0 | exactly 0 | Even count, equal z pairs both sides at `(j + .5) * 64 / pairs` |
| 8 | CRYSTAL | 8 | 2000 | 3.5 / 0 | floating | .8-4 | 50-450 | height + hover 3-28 | uniform `[0, TAU)` | |
| 9 | SAUCER | 2 | 3000 | 3 / 0 | floating | 1-2.5 | 100-1400 | height + hover 40-150 | uniform `[0, TAU)` | Beam length is T05's. Floats above the band limit of §5.3 |
| 10 | SEARCHLIGHT | 1 | 3000 | 6 / 6 | grounded | 1-1.5 | 90-500 | ground | uniform `[0, TAU)`: sweep phase offset | Only on `chunk % 6 === 0`, so at most 8 live in 47 chunks (§6.5). `top` is the housing; the additive beam is exempt from keep-out because it does not occlude |
| 11 | TOTEM | 6 | 1200 | 9 / 1.5 | grounded | .7-1.3 | 50-84 .6, 86-320 .4 | ground | uniform `[0, TAU)` | |
| 12 | DISH | 1 | 3000 | 18 / 8 | grounded | .6-1.5 | 110-500 | ground | facing | |
| 13 | RING | 1 | 6000 | 100 / 0 | floating | 1 | exactly 0 | exactly 65.14 | exactly 0 | Only on `chunk % 48 === 0`, `zLocal = 32`, `keep = 0`, so it survives every tier. `y` is the torus centre. T05 draws it from the record, which puts the ring on the disc outline at 465 u (`(65.14 - 7) / 465 = .125`, `100 / 465 = .215`). Exempt from keep-out. `top` and `root` are T05's and unused here |
| 14 | OBELISK | 3 | 3000 | 40 / 20 | grounded, tall | .5-3 | 100-520 .5, 1040-1800 .5 | ground | uniform `[0, TAU)` | |
| 15 | DOME | 1 | 2000 | 20 / 6 | grounded | .5-1.4 | 105-450 | ground | uniform `[0, TAU)` | `top` is the radius |
| 16 | TURBINE | 2 | 2000 | 40 / 20 | grounded, tall | .5-2.2 | 110-520 .5, 1040-1500 .5 | ground | facing | `top` includes the blade tip |
| 17 | CASSETTE | 1 | 2000 | 16 / 8 | grounded | .6-1.3 | 90-420 | ground | facing | |
| 18 | CACTUS | 8 | 1200 | 8 / 1.5 | grounded | .7-1.4 | 50-84 .5, 86-320 .5 | ground | uniform `[0, TAU)` | |
| 19 | CHEVRON | 4 | 800 | 5 / 1 | grounded | 1 | 46-49 | exactly 0 | facing | |

"Facing" means `yaw = -sign(x) * (.2 + .3 * draw)`, so the front turns slightly toward the road from either side. Side alternates candidate by candidate, so left and right stay within 1 of each other per archetype, before rejection.

### ItemRow records

`count` is the live total, records past it are zero. Records are in ascending `kind`, and inside a kind by ascending `zLocal`, with no global z sort. `(chunk, record ordinal)` is a stable identity, used by `EventBuffer.chunk` and `.index`. All items have `abs(x) <= PLAY_HALF_X + 2`, on the flat valley floor, and `y` is absolute world y. `seed` is uniform in `[0, 1)` for every kind. All numbers are [A].

| Kind | Per chunk | `x` | `y` | `zLocal` | `radius` | `a` | `b` |
|---|---|---|---|---|---|---|---|
| SHARD | 12 | `laneX` at this z, plus or minus 5 on double-rail runs | 5.5 to 10.5, by pattern | On the world 12 u lattice: first value 0, 8, 4 for `chunk % 3` = 0, 1, 2 [O] | 2.5, pickup | 0 | 0 |
| GATE | 1 | `laneX`, within 26 | 8, opening centre | 0 | 9, opening radius: threaded when `hypot(px - x, py - y) <= radius` | 0 | 0 |
| GATE, checkpoint | 1, at `c % 100 === 0`, taking the place of a normal gate when that chunk is also a multiple of 3 | 0 | 8 | 0 | 42, spans the play window | **1** | 0 |
| SPIKE | 4 | At least `radius + 5` from `laneX` at its z | 3.5, centre of the circle, so it spans 0 to 7. T05 adds a tether to the floor | Stratified. In gate chunks, 16 or more | 3.5 | 0 | 0 |
| FENCE | 2 | 0, span centre | 8, the middle of the play window. Informational: a fence hits at any y, and T05 draws it filling the window's height | Stratified, never in a gate chunk | 42, span half-width; posts at `x +- radius` | Gap centre x, absolute u, equal to `laneX` clamped to 28 | Gap half-width, 12 at zone 0 to 7 at zone 12 |
| DRONE | 3 | Oscillation centre. At least `a + radius + 3` from `laneX` | 5 to 12 | Stratified | 2.5 | Amplitude, 3 to 8 u | Integer k, 1 |
| TRAFFIC | 4 | Lane centre, one of -15, -7, 7, 15 | 2.5, collision centre, on the road | Stratified, start of its conveyor | 3 | Travel u, one of 64, 96, 128, never above `TRAFFIC_TRAVEL_MAX` | Integer k with `a * k / 256` in 20 to 40 u/s |

Motion is `core/motion.ts` exactly. DRONE: `x + droneOffset(a, b, seed, phases[3])`; k = 1 is 1 Hz, which is why amplitude stops at 8 u. TRAFFIC: `zLocal + trafficOffset(a, b, seed, phases[7])`, forward. With `f = fract(b * phases[7] + seed)`, its scale is `min(1, f / TRAFFIC_FADE, (1 - f) / TRAFFIC_FADE)`, and it only collides while that is 1.

A straight line between consecutive lane nodes (`G(n)` in M6, every 3 chunks), at y = 8, with ship radius up to 2 u, misses every SPIKE, DRONE (at full amplitude), FENCE and TRAFFIC car, and threads every gate. A test proves this, which is what gives T02's autopilot a solvable road.

### ZoneState fields

Zone `index = floor(c / 100)`, where `c` is `at.chunk` reduced by `periodChunks`.

| Field | Meaning |
|---|---|
| `biomeA`, `paletteA`, `heroA`, `objective` | This zone's entries. Biome numbering is `Biome`, palette numbering is `PaletteId`, §6.8 order |
| `biomeB`, `paletteB`, `heroB` | The next zone's entries, always, even at mix 0. A consumer must ignore B at mix 0 |
| `biomeMix`, `paletteMix`, `heroMix` | One value `m = smooth((into - 75) / 25)`, with `into = c mod 100 + local / 64`. 0 through chunk 75 of the zone, exactly 1 at the next zone's first chunk, where A takes over B's value, so nothing jumps |
| `palette` | Already mixed in OKLCh, clamped to `[0, 1]`, linear. Nobody re-mixes it |
| `objectiveTarget` | Integer. GATES: gates threaded, `12 + d`. CHAIN: consecutive shards, `24 + 3d`. GRAZES: grazes, `6 + d`. NO_HIT: u without a hit, `1600 + 200d`. BOOST: u boosted, `800 + 100d`. `d = min(index, 12)` |
| `musicKey` | Integer semitone offset in `[0, 12)`, `(index * 7) % 12`, a circle-of-fifths walk |
| `dayPhase` | Sawtooth in `[0, 1)`, `((c % 750) + local / 64) / 750`. Wraps once per 750 chunks, so use integer harmonics |

### Seams

Meanings other tasks must share, which the types do not settle.

| Other task | Topic | T01's assumption |
|---|---|---|
| T02 | Sim's item window | §5.8's window is home chunks `c - 2 .. c + 1` as the sweep's need, with `c = travel.chunk` (`ITEM_WINDOW_BEHIND = 2`). That is enough because a car's `zLocal + a < 192`, so it stays within home chunk + 2. T02 keeps 8 rows, `c - 2 .. c + 5`, for its planner, which is compatible. Rows are read on chunk crossing and cached |
| T02 | Gate semantics | Threaded when `hypot(px - x, py - y) <= radius` at the swept z crossing, using the bare `radius`. A gate with `a === 1` is a sector checkpoint at `c % 100 === 0`: never a miss, no SYNC change, the autopilot does not steer for it, and T02 grades on `zone.index` changing. In one zone of three it takes the place of a normal gate, so a zone has 32 or 33 normal gates |
| T02 | Fence collision | Hit when `abs(px - x) <= radius` and the ship is outside the gap, at any y. T02 narrows the gap by its ship radius, `abs(px - a) > b - 1.6`. T01's narrowest `b` of 7 and the lane stay compatible with that. Grazing is T02's rule |
| T02 | Spike, drone, traffic, shard | Circle in `(x, y)` of `radius`, swept in z, with motion applied through `core/motion.ts` at alpha 0 phases. Traffic collides only when its fade scale is 1 |
| T02 | Ship radius and autopilot height | Ship collision radius is at most 2 u (T02: 1.6). The solvable-road test assumes y = 8 and straight lines between lane nodes. A ship at the rest height y = 6 can touch traffic, whose top is at 5.5 with radius added. T02's planner handles that; it is not a guarantee at every y |
| T02 | Record identity | `EventBuffer.chunk` is the row's `chunk` as passed, and `.index` is the record ordinal in `fillItems` output, which is stable. Only SHARD needs hiding after pickup |
| T02, T08 | `objectiveTarget` units | As in the ZoneState table, and `SimState.objectiveProgress` counts in the same unit. T08 converts u to km for display |
| T02 | Test worlds | T02's goldens use its own fixture world, not `createWorld`, so T01 or T11 tuning cannot flip them. T10 runs the autopilot on the real world |
| T03 | Height calls | Valid for any power-of-two `zs` and negative `iz`. Same world point gives the identical double through any split [O: 0 mismatches of 25,200, including `2^48 - 1025`]. Rows of equal `(iz, zs, zLocal)` reuse a one-entry memo, so call row by row and do not interleave rows in an inner loop. Biome crossfade is continuous in z, not stepped per chunk |
| T03 | Coarse mesh shape | The gate assumes lattice columns at `x = (c - 64) * s`, rows at integer multiples of s, triangles split by the diagonal from `(c + s, row)` to `(c, row + s)`, from §6.4's odd-row morph, level picked per `levelAt` (M4), morph complete at ratio .9. This triangle shape reproduced §5.7's table to two figures [O]. A different diagonal changes only which candidates are rejected |
| T04 | Hero and biome keys | `heroA/B/Mix` per the ZoneState table, and hero uses its own permutation of 4. Sky events read `Biome.ORBITAL_NIGHT` and `Biome.CYBER_CANYON` from `biomeA`, and fade with `biomeMix`. `dayPhase` is a sawtooth |
| T05 | Everything in the two record tables | Ring capacity trusts `perChunk`. `y` is the mesh origin, grounded origin is ground contact, floating origin is the centre. Instance scale is uniform. T05 builds each mesh within `top` and `root` at scale 1, and tests this. T05 writes no yaw of its own, so facing archetypes are BILLBOARD, DISH, TURBINE, CASSETTE, CHEVRON as in the table |
| T05 | Item drawing | Item meshes scale by `radius`, except SHARD, which T05 draws at a fixed size. FENCE posts at `x +- radius`, gap from `a`, `b`. Traffic's §6.5 cull test uses the offset position. T05 keeps 3 rear rows for traffic, capacity 116 (§6.5), which covers `zLocal + a < 192`. Hide a picked-up shard using `(chunk, index)` from events |
| T05 | Roster hiding and density | `start` tells T05 which archetypes a row holds, for "hide idle rings". RING has `keep = 0`. For the rest, the count with `keep < d` in a row is within 2 of `n * d`, measured, not exactly `n * d`. T01 does not promise to stay under T05's `perRowClamp`. T05 lifts the excess's ring `keep` by rank, so it thins with the ramp and the clamp cuts no live record (DI-41). PYLON is set per its row so the lift cannot change it and no line can break |
| T05 | Real world on the dev page | Once T01 lands, `dev/props.html` may pass `createWorld({ seed: 1985, periodChunks: 0 })` as `DevShellOptions.world`. It is optional |
| T00 | `createFakeWorld` | The fake copies these rows (S-07): RING `x 0, y 65.14, zLocal 32, keep 0`, and PYLON `x +-100, y 0, zLocal 0, keep .1 / .6`, with the `variant` flag. Items follow the ItemRow table (`GATE y 8, radius 9`; `FENCE x 0, radius 42, y 8`) |
| T00 | `hash01` use | `a` is an archetype, or a salt from M1 to M6, `b` a small integer, both integer-valued. Zone permutations pass a block index in the `chunk` slot, which may be negative |
| T00 | Check gate | `check:task T01` spawns Vitest on all `tests/unit/world/*.test.ts`. T01's perf and preview files do real work only under an env var, and otherwise run in under 3 s. `tests/unit/world/support/*.ts` are in `tsconfig.node.json` through its `tests/**` include |
| T06 | `dayPhase` | T06's draft reads it through `cos(TAU * dayPhase)` for exposure, an integer harmonic, so the sawtooth wrap does not pop |
| T07 | `musicKey` | Semitone offset in `[0, 12)` above T07's base key. T07 picks the base and scale |
| T08 | Sector display | `zone.index` and `sim.sectorIndex` are the same number, except for one frame at a boundary, raw zone index from 0. `biomeA` and `paletteA` index `BIOME_NAMES` and `PALETTE_NAMES` (§8.1), in the same order as `Biome` and `PaletteId` |
| T09 | Harness world | Passes `periodChunks = 1024`. Every function of chunk reduces first, so `k` and `k + 1024 * 2^37` are byte-identical [O for height]. The periodic world has a visible seam at chunk multiples of 1024, where zone 10 (24 chunks) jumps to zone 0, in height and lanes. Identity tests are unaffected. Do not judge visuals across it |
| T09 | Non-flat check at warp | A pixel test at the far field cannot see one flat octave. T01's per-octave test is the guard, T09's only proves integration |
| T10 | Boot and overrides | `createWorld` throws `RangeError` on bad options, so parse `?seed=` before calling. `overrideZone` writes `palette` with `writePalette`, and sets `biomeA = biomeB = biome`, `heroA = heroB = hero`, mixes 0. Terrain and props still follow the chunk's real biome, because they are pure |
| T11 | Contact sheet | To see a true biome and palette pair, warp to `findZoneChunk(seed, palette, biome)` rather than `forceZone`. All 36 pairs appear by zone 124 on seed 1985 [O] |
| T11 | Tuning | `palettes.ts` and `biomes.ts` hold every tunable, including `KEEPOUT_K`. `npx vitest run tests/unit/world` must stay green after a retune. A terrain retune that fails `sag calibration` prints the new table to paste. Lowering a density floor needs a Decision log entry here |

## 5. Plan of work

Milestones run in order. Each ends green on its own test file.

### M0. Preconditions

**Goal:** know the contract text. **Work:** read `src/contracts/index.ts`, `src/core/hash.ts`, and section 12 below. Every request T01 needs is already in §8, so no fallback applies. **Result:** Progress names what was read. **Proof:** `npm run contracts:check` exits 0 (T00's gate), and `npm run check:task -- T01` reports `VACUOUS`, the correct state before any file exists.

### M1. Noise

**Goal:** §4.4 noise, with regression tests that can fail. **Work:** `noise.ts`:

```ts
export interface Noise { oct(x: number, iz: number, zs: number, zLocal: number, wl: number): number }
export function createNoise(seed: number, periodChunks: number): Noise;
```

Body is §4.4's `oct`, `gradP`, `hsh` verbatim, in a closure over `GX`, `GZ` (`Float64Array(256)`) and `period`, with `!` on typed-array reads. Gradient table: `t = hash01(seed, 0, 0x4E01, i) * 2 * Math.PI`, `GX[i] = cos t`, `GZ[i] = sin t`, built once at creation.

`support/mutants.ts` holds three broken octaves, built on the same `gradP` so only the fault differs:

- `octInt32`: `z = iz * zs + zLocal; zc = Math.floor(z / wl) | 0; fz = z / wl - zc; if (fz > 1 || fz < 0) return 0;`, the `simplex-noise` failure class.
- `octNaive`: `z = iz * zs + zLocal; zc = Math.floor(z / wl); fz = z / wl - zc;`, a plain double.
- `octLoHash`: correct cell, then `zc % 2 ** 32` before hashing, dropping the high word.

`support/metrics.ts` exports `octaveReport(oct, D, wl)`, measured at world distance `D` (`chunk = floor(D / 64)`, `base = chunk * 32`, `zs = 2`), returning:

- `range`, `zeroFrac`, `outOfBounds` over 4000 samples: `iz = base + (i * 7) % 1024`, `zLocal = fract(i * .61803398875) * 2`, `x = 187 + fract(i * .754877666) * 1500`. Irrational steps avoid lattice points, where gradient noise is exactly 0.
- `eqStep`: fraction of consecutive equal values at fixed `x = 437.3`, stepping `zLocal` by 1/64 u, over 1024 steps.

Thresholds and what the rehearsal saw [O]:

| Rule | Threshold | Real noise | `octInt32` | `octNaive` |
|---|---|---|---|---|
| `range` per octave | at least .5 | .84 to 1.26 everywhere | 1e9: passes, all octaves. 1e12: **only wl 512 alive (.98), the other four 0**. 1e15: all 0 | Passes |
| `zeroFrac` | under 1% | 0% | 100% where flat | 0% |
| `eqStep` | under 1% | 0% | 100% where flat | 1e12: 0%. **1e15: 87.5%**. 1.8e16: 99.2% |
| `outOfBounds`, `abs(v) > 1` | 0 | 0, max seen .698 | 0 | 0 |

So 1e9 alone passes the int32 bug, a sum of octaves at 1e12 still looks alive with four of five octaves dead, and `range` alone passes the naive bug. All three checks must be per octave, at all three distances. That table is why.

The alias test compares the same point through `iz` and `iz + 2^32 * (wl / 2)`, at 500 x values and wl 512 to 32: real noise 0 of 500 equal, `octLoHash` 500 of 500 equal [O]. Those offsets are 2.2e12 u down to 1.4e11 u, so no warp test would see them.

Goldens, `oct` with seed 1985, period 0, asserted by `toBe` [O]:

| `oct(x, iz, zs, zLocal, wl)` | Value |
|---|---|
| 437.25, 1000, 2, 0.5, 512 | 0.07184933147057126 |
| 437.25, 1000, 2, 0.5, 32 | -0.5145153581947712 |
| -1212.5, 15625000, 64, 3.25, 128 | -0.15316878872587994 |
| 1287.5, 500000000, 2, 1.25, 256 | -0.009746942939047648 |
| 150.75, 500000000000, 2, 0.75, 64 | -0.08922293236122636 |
| 150.75, 500000000000000, 2, 0.75, 32 | -0.14889955578140582 |
| 2000.125, 2^52, 2, 1.5, 512 | -0.07321358019691425 |

Test names the drills rely on: `per octave non-flat at 1e9`, `at 1e12`, `at 1e15` (range, zero fraction, bounds), `fine step at 1e15` (`eqStep`), `no high-word alias`.

**Result:** `noise.ts` and `noise.test.ts`. **Proof:** A1, A1n.

### M2. Palettes, biomes, zones

**Goal:** the pure tables and zone logic. **Work:**

`palettes.ts`: the §6.8 table as hex strings, in order, converted at module load to linear and OKLab `Float64Array`s (Bjorn Ottosson's matrices; sRGB to OKLab to linear round trip worst 2.6e-7 [O]). `mixPalette(a, b, m, out)` works per slot in OKLCh: lerp L, lerp C, shortest arc on hue, and if either end has chroma under .02, take the other end's hue. Converts by `cos`, `sin` and cubing (no `pow`), and clamps to `[0, 1]`, allocation-free. Clamping is needed: for straight OKLab, over all pairs, slots and 21 mix steps, values reached -.0035 and 1.0238, in 18 of 210 pair-slot cases [O].

`biomes.ts`, all tunables, in `Biome` order:

| Biome | `rise` | `a0` | `a1` | `gain` | Basis |
|---|---|---|---|---|---|
| Boulevard | 430 | 135 | 250 | .52 | §5.2 [O] |
| Neon City | 430 | 100 | 185 | .52 | [A] "lower" |
| Crystal Desert | 620 | 85 | 170 | .46 | [A] "lower, wider" |
| Cyber Canyon | 180 | 230 | 300 | .55 | [A] "high walls"; p95 / abs(x) peaks at .70 [O] |
| Orbital Night | 430 | 135 | 250 | .52 | §5.4 default |
| Olympus | 430 | 135 | 250 | .52 | §5.4 default |

Quotas, expected count per chunk. A blank is 0. Bold marks §5.4's signature scenery. REFLECTOR and CHEVRON are the always-on speed layer. RING is not here: it is in every biome on chunk multiples of 48. All [A], rehearsed for fill and density [O], except fade.

| Archetype | Boulevard | Neon City | Crystal Desert | Cyber Canyon | Orbital Night | Olympus |
|---|---|---|---|---|---|---|
| PALM | **10** | | | | | |
| ARCOLOGY | 2 | **6** | | | | |
| PYRAMID | | | **2** | | 1 | 2 |
| ORB | | | | | **3** | **2** |
| COLONNADE | | | | | | **6** |
| BILLBOARD | **3** | **3** | | | | |
| PYLON | | **2** | | **2** | 2 | |
| REFLECTOR | **32** | 24 | 16 | 32 | 24 | 16 |
| CRYSTAL | | | **8** | 3 | 3 | 2 |
| SAUCER | | | | | **2** | |
| SEARCHLIGHT | | **1/6** | | 1/6 | | |
| TOTEM | | 2 | | | | **6** |
| DISH | | | | **1** | **1** | |
| OBELISK | 1 | **3** | **2** | 3 | 1 | 2 |
| DOME | | | | | **1** | 1 |
| TURBINE | | | | **2** | | |
| CASSETTE | | | | **1** | | |
| CACTUS | | | **8** | | | |
| CHEVRON | **4** | 2 | 1 | 4 | 2 | 2 |

`PLACE[a]`: scale range, bands, hover and yaw mode from section 4's table. `SAG[terrainClass][spacingIndex][band]`: see M4. `KEEPOUT_K = 0.05`, `KEEPOUT_C = 0.24` (§5.6).

`zones.ts`: `createZones(seed, periodChunks)`. Inside: a scratch `Uint8Array(6)`, and:

```
perm(block, salt, n): identity, then for i = n-1..1: j = floor(hash01(seed, block, salt, i) * (i+1)); swap
entry(z, salt, n):    block = floor(z / n); i = z - block * n
                      perm(block - 1, ...); prevLast = scratch[n-1]
                      perm(block, ...);     if scratch[0] === prevLast swap scratch[0], scratch[1]
                      return scratch[i]
```

Salts: `0x5A01` biome (n 6), `0x5A02` palette (n 6), `0x5A03` hero (n 4), `0x5A04` objective (n 5). Rehearsed for biome, palette and hero: 0 adjacent repeats in 100,000 zones, all 36 pairs seen by zone 124, biome counts uniform within 1 [O]. `zoneAt` per section 4. `bendAt` is §5.3's formula on a scratch reduced `Travel`, with `c = -1.2e-5`, `vMax = 1500` [A]. `findZoneChunk` scans zones from 0.

**Result:** those three files with tests. **Proof:** A2, A3.

### M3. Height

**Goal:** §5.2 with continuous biome crossfade. **Work:** `height.ts`:

```ts
export interface TerrainParams { rise: number; a0: number; a1: number; gain: number }
/** §5.2 with fixed params. Pure. The golden and the statistics tests call this, so biome tuning cannot break them. */
export function heightWith(n: Noise, p: Readonly<TerrainParams>, x: number, iz: number, zs: number, zLocal: number): number;
export interface HeightCore { readonly regs: Float64Array; run(): void }             // write x, iz, zs, zLocal, call run, read OUT: no double crosses a call
export interface Height extends HeightCore { readonly at: HeightFn }                  // `at` is WorldSource.height
export function createHeight(n: Noise, zones: Zones, periodChunks: number, terrain?: readonly Readonly<TerrainParams>[]): Height;
```

`createHeight`'s function: return 0 at once when `abs(x) <= VALLEY_HALF`. Otherwise fill a one-entry memo keyed on `(iz, zs, zLocal)`, a `Float64Array`, not object fields:

```
if zs <= 64: ra = 64/zs; q = floor(iz/ra); rem = iz - q*ra; pos = (rem*zs + zLocal)/64; fl = floor(pos); c = q + fl; frac = pos - fl
else:        ra = zs/64; pos = zLocal/64; fl = floor(pos); c = iz*ra + fl; frac = pos - fl
reduce c by periodChunks; z = floor(c/100); into = c - z*100 + frac; m = smooth((into - 75)/25)
params = lerp(TERRAIN[entry(z, 0x5A01, 6)], TERRAIN[entry(z + 1, 0x5A01, 6)], m)
```

A second one-entry memo on `z` holds the two biome ids, because scatter misses the row memo on every record [O: a memo-hit level-0 row costs 11 to 13 us, a level-5 row 28 us]. Neither memo can change a result, and a test proves it. Mix is on exact z, as §5.2 states (DI-39): a mix stepped per chunk doubles the mean row step at chunk edges in a Boulevard to Canyon fade, 2.16 times other rows against 1.02 [O], a ridge every 64 u. Rehearsal: largest change across a .0002 u step at zone edges .0014 u [O].

Goldens, `heightWith` on Boulevard params, seed 1985, by `toBe` [O]:

| `(x, iz, zs, zLocal)` | Value |
|---|---|
| 150, 1000, 2, 0.5 | 3.125618514997149 |
| 515.5, 1000, 2, 0.5 | 130.76588773885882 |
| -1000.25, 15625000, 64, 3.25 | 211.02120995099142 |
| 2000, 500000000000, 2, 0.75 | 347.9489411765333 |
| 4000, 500000000000000, 2, 0.75 | 253.83894945696144 |
| 85, 1000, 2, 0.5 | 0 |
| 85.5, 1000, 2, 0.5 | 0.00020830239364939826 |

Statistics rehearsed on seed 1985 [O], against §5.2's table: p50 at 150, 300, 515, 1000, 2000, 4000 is 4.6, 36, 103, 195, 226, 224 (§5.2: 4.3, 34, 102, 208, 251, 227), so a tolerance of plus or minus 15% holds. Peak p95 / abs(x) .27.

**Result:** `height.ts`, `height.test.ts`. **Proof:** A4, A4n.

### M4. Keep-out and grounding

**Goal:** §5.6 and §5.7 as small pure functions. **Work:**

`keepout.ts`:

```ts
/** Scale that keeps the top under the keep-out, or 0 if it would fall below 0.5. absX >= KEEPOUT_C * FOG_END: unchanged. k is KEEPOUT_K, passed in so tests can vary it. */
export function fitKeepOut(absX: number, y: number, top: number, scale: number, k: number): number;
// room = absX * k / KEEPOUT_C - y; if (top * scale > room) scale = room / top; return scale < .5 ? 0 : scale;
```

`y` is the mesh origin in world y, so `y + top * scale` is a true world height including the terrain. §5.6 states that (DI-06), since its derivation is geometric. The consequence is in section 10: on default terrain, room is at most about 29 u for all `abs(x) <= 1032`. That is why tall archetypes have two bands.

`grounding.ts`:

```
levelAt(absX, maxDist): first L with absX < halfW[L] and maxDist < forward[L]
   halfW[L]   = CLIP_COLS / 2 * s[L]
   forward[L] = (CLIP_ROWS - CLIP_REAR_ROWS[L]) * s[L]      // gives §6.4's 160, 352, 736, 1504, 3008, 6016
   s[L]       = CLIP_BASE_SPACING * 2^L
spacingAt(absX, maxDist): s[L], doubled if max(absX/halfW[L], maxDist/forward[L]) > .6, since morph has begun (§6.4)
coarseSurface(x, chunk, zLocal, s): triangle from section 4's T03 seam, using world height at the 3 corners
sag95(biome, absX, s): SAG[class][log2(s) - 2][band], band edges 200, 500, 1400; class boulevard/neon/desert/canyon
```

`SAG` is the absolute p95 of `true - surface`, 30,000 samples per cell [O]. Boulevard's row matches §5.7's table within rounding (.12 / 1.1 / 3.1 at s 8, .76 / 5.7 / 16 at s 32), which also confirms the triangle shape:

| Class, band edges 85-200, 200-500, 500-1400, above | s 4 | s 8 | s 16 | s 32 | s 64 | s 128 |
|---|---|---|---|---|---|---|
| Boulevard, Orbital, Olympus | .04 .39 1.2 1.6 | .12 1.1 3.1 3.8 | .31 2.6 7.7 9.2 | .74 5.7 16 19.5 | 1.7 11.3 31 37.5 | 5.2 20 53 65 |
| Neon City | .03 .29 .87 1.15 | .09 .79 2.3 2.8 | .23 1.95 5.7 6.8 | .55 4.2 11.7 14.4 | 1.25 8.4 22.5 27.8 | 3.9 14.7 39 48 |
| Crystal Desert | .01 .12 .57 .77 | .03 .33 1.56 1.92 | .08 .86 3.94 4.77 | .21 2.05 8.6 10.6 | .53 4.42 18.3 22.7 | 1.9 8.7 33.8 42.2 |
| Cyber Canyon | .34 1.09 1.93 2.45 | 1 2.72 5.03 6 | 2.47 6.39 12.1 14.2 | 5.29 13 24.5 29.4 | 10.8 25.1 45 54.1 | 21.2 41.5 75.7 90.9 |

The placement steps, for a candidate at `(x, zLocal)` in chunk `c`, with `h` its true height, `top`, `root`, `scale`:

1. **Floating:** `y = h + hover`. No sink, no keep-out, no gate. Accept.
2. **Valley, `abs(x) <= 85`:** `y = 0`, then `fitKeepOut` unless exempt. No sag gate (§5.7 rule 1).
3. **Rise and far:** `s = spacingAt(abs x, maxDist)`, `sink = min(sag95, .3 * top * scale)`, `y = h - sink`. Then `fitKeepOut` unless exempt. Then `g = coarseSurface(...) - CLIP_DROP[level]`. Reject if `h - g - sink > root * scale`, which would float, or `g - y > .7 * top * scale`, which would be mostly buried.

**§5.7 rule 2 states this cap.** Without it a small object with a long `maxDist` on steep terrain drowned: in Cyber Canyon, DISH placed .27 per chunk of a quota of 1, CASSETTE .22. With the cap and deeper roots, .98 and .96 [O]. The float gate still protects it, since a candidate that would show daylight is rejected.

**Exempt from keep-out:** floating, RING, SEARCHLIGHT, and any candidate whose source biome is Cyber Canyon.

**Result:** two files, two test files. **Proof:** A5, A5n, A6, A6n.

### M5. Scatter

**Goal:** dense, varied, pure rows. **Work:** `scatter.ts`:

```ts
export interface ScatterTable { quota: readonly (readonly number[])[]; place: readonly Placement[]; sag: SagTable; keepoutK: number }
export function createScatter(seed: number, periodChunks: number, table: Readonly<ScatterTable>, h: HeightCore, zones: Zones):
  (chunk: number, out: PropRow) => void;
```

Algorithm, for chunk `c` (reduced), with `m` the biome mix at the row centre (`into = c mod 100 + .5`), `qA`, `qB` the two biomes' quotas:

```
w = 0
for a in 0 .. 19:
  start[a] = w
  RING:        if c % 48 === 0, write it; continue
  expected = (1 - m) * qA[a] + m * qB[a]
  PYLON:       if expected >= 1 write the pair with variant = (expected at row c + 1) >= 1 ? .75 : .25; continue    // no dither, so a line starts and ends once per fade
               // row c + 1 is evaluated by the same formula after period reduction
  SEARCHLIGHT: if c % 6 !== 0, continue; n = hash01(seed,c,a,0) < expected * 6 ? 1 : 0
  REFLECTOR:   n = 2 * round(expected / 2)
  otherwise:   n = floor(expected + hash01(seed,c,a,0))
  n = min(n, ARCHETYPE_SPEC[a]!.perChunk)
  for i in 0 .. n-1:
    up to 4 tries t, stopping on acceptance. base = 32 + i*32 + t*8. Draws hash01(seed,c,a, base + k):
      k=0 z jitter:  zLocal = fround(min((i + draw) / n * 64, 63.99999))        // stratified, one per slot
      k=1 lateral:   within the band
      k=2 scale      k=3 hover      k=4 yaw      k=5 tintSeed      k=6 variant
      k=7 source:    source = draw * expected < (1 - m) * qA[a] ? A : B          // picks the exemption and sag class
    band pick:   r = fract(hash01(seed,c,a,2) + i * .6180339887 + t * .37), walked through the band weights  // proportions are stable per row
    side:        ((i + floor(fract(phase[a] + c * .6180339887) * 2)) & 1) ? +1 : -1      // phase[a] = hash01(seed,0,a,1), a golden-ratio walk per archetype (section 11)
    keep:        min(fract(hash01(seed,c,a,3) + i * .6180339887), 0.99999994)
    apply M4's steps; on acceptance write the 8 fields at w * PROP_STRIDE, w++
start[20] = w; data.fill(0, w * PROP_STRIDE); out.chunk = chunk
```

Coding rules, each from a measured result:

- **No `for...of`, no closures in the loop, no object fields updated with doubles.** The rehearsal scatter measured 136 B per call with `for...of` over bands and a stats object, against .3 B per call for plain loops of `hash01` writes [O]. Which of the two costs what was not isolated; just avoid both.
- `zLocal` is `Math.fround`ed before the height lookup, so the stored value is the one that was grounded.
- All scratch lives in the factory closure, never at module level, or two worlds would share it.

**How density and variety are guaranteed,** not left to chance:

| Mechanism | What it prevents |
|---|---|
| `floor(expected + dither)` per archetype, no Poisson | A row can never draw far under quota |
| Stratified z, one candidate per slot of `64 / n` | Clumps and gaps along the road |
| Alternating sides, with a golden-ratio starting side per row | A bare side of the road, and a bare screen column |
| Golden-ratio band pick per row | Rows with no near objects, or no far ones. Boulevard's minimum shoulder count went from 3 to 7 [O] |
| 4 retries inside the same slot | Rejection thinning on rough ground. Fill is at least .96 of quota for every archetype except Canyon's SEARCHLIGHT at .85 [O] |
| Every biome has quota in shoulder, rise and far | An empty middle distance or skyline |
| REFLECTOR and CHEVRON in every biome | Losing the sense of speed |
| Fade quotas are a linear mix | A density dip mid-transition: the row total is a mix of two floors |
| Tests below on the real table | A later tune that hollows out a biome fails `check:task` |

Density floors, each measured on the real table, seed 1985, 200 positions per biome (`density.test.ts`). The Measured column is the rehearsal's worst biome [O], and fade rows must meet the same floors [A].

| Rule | Floor | Measured |
|---|---|---|
| Row total, every row of every biome and every fade | at least 32 | 36 (Desert) |
| Live within `maxDist` from a camera at any position | at least 700 | 828 |
| Near shoulder scenery (`abs(x) <= 85`, without REFLECTOR, CHEVRON), row mean | Boulevard, Olympus at least 7; Desert at least 4 | 8.8, 8.6, 4.7 |
| Rise scenery (85 to 520), row mean, every biome | at least 5 | 5.3 (Boulevard) |
| Far scenery (above 520), row mean, every biome | at least 1.5 | 1.87 (Boulevard) |
| Fill: placed over quota, per archetype per biome | at least .9, SEARCHLIGHT at least .7 | .96 (CASSETTE), SEARCHLIGHT .85, both Canyon |
| Distinct archetypes in any rolling 10 chunks | at least 6 | 6 |
| Each signature archetype present in every rolling 10 chunks, SEARCHLIGHT excepted | All | 0 misses in 3000 chunks per biome |
| Screen columns (16 over 1080p width, objects at least 8 px tall): worst position | at least 1 in every column | 1 |
| Screen columns: mean | at least 5 in every column, at least 30 in the centre four | 7, 35 |
| Biome identity: cosine similarity of row histograms without REFLECTOR, CHEVRON, any pair | at most .65 | .587 (Canyon and Orbital) |
| Coverage: every archetype 0 to 19 appears in a run of 600 zones | 20 of 20 | 19 have quota, plus RING; the run itself not done |
| SEARCHLIGHT live in any 47-chunk window | at most 8 | 8 by construction |
| Thinning: at density .7 and .4, kept count in a row with `n >= 4` is within 2 of `n * d`, and the mean kept share within .01 of d | All | 0 of 42,000 beyond 2 (2560 beyond 1); means .700, .400 |

Rehearsed cost of this algorithm, single biome, no fade [O]: p50 14.8 to 23.8 us, p99 24 to 40 us. Live triangle estimate from §6.5's targets at most 108,000 per position, under the 317k worst case.

**Result:** `scatter.ts`, `scatter.test.ts`, `density.test.ts`. **Proof:** A7, A7n, A8, A8n.

### M6. Items

**Goal:** a road a player can read and solve. **Work:**

`lanes.ts`: `laneX(seed, periodChunks, chunk, zLocal)`:

```
G(n) = 26 * (2 * vnoise(n / 3) - 1)        // vnoise: smooth lerp of hash01(seed, node, 0x6100, 0) at integer nodes
n = floor(c / 3); t = (zLocal + (c - 3n) * 64) / 192
laneX = G(n) + (G(n + 1) - G(n)) * smooth(t)
```

Consecutive gates therefore differ by at most about 26 u, which is 11 u/s at cruise [arithmetic]. Straight line against smooth lane differs by at most about 2.5 u (`max abs(smooth(t) - t) = .096`), which the hazard margins allow for.

`items.ts`, with `d = min(zone.index, 12) / 12`, salts `0x6000 + kind`, in kind order:

- **SHARD.** Interval pattern `floor(hash01(seed, n, 0x6000, 0) * 4)`, with `n = floor(c / 3)`: 0 full line at y 8; 1 every second lattice point at y 8; 2 full line with `y = 8 + 2.5 * sin(TAU * j / 16)`, `j` the lattice index in the interval; 3 double rail at `laneX +- 5`, y 8. At most 12 per chunk [O: 6, 5, 5 lattice points per chunk].
- **GATE.** `c % 100 === 0`: checkpoint. Otherwise `c % 3 === 0`: normal. At most 1.
- **SPIKE.** `n = floor(.4 + 1.6 * d + dither)`, at most 4. `x = laneX + side * (8.5 + draw * 12)`, clamped to 38, where `side` is away from the road centre when `abs(laneX) >= 10`, otherwise a draw.
- **FENCE.** Only when `c % 3 !== 0`. `n = floor(.15 + .35 * d + dither)`, at most 2, with z separated by at least 24 u, and `zLocal <= 32` when `c % 3 === 2`, so a fence is never within 32 u before a gate. `b = 12 - 5 * d`.
- **DRONE.** `n = floor(.2 + 1.2 * d + dither)`, at most 3. `a = 3 + 5 * draw`, `b = 1`. `x = laneX + side * (a + 2.5 + 4.5 + draw * 6)`, same side rule, except that when the outer side would break `abs(x) + a <= 40` the drone goes on the inner side (section 11).
- **TRAFFIC.** `n = floor(w + dither)`, at most 4, with `w = 1.5 + 1.5 * d` for a Boulevard source and `.3 + .7 * d` otherwise, mixed by `m`. `a` from {64, 96, 128}; `b = round(speed * 256 / a)`, with `speed` a draw in 21 to 39 u/s, so rounding cannot leave 20 to 40.

Total at most 26, under `MAX_ITEMS_PER_CHUNK`. `seed` from a draw, clamped under 1, on every record.

Hazard density and traffic weights live in `items.ts`, not `biomes.ts`, because §12 does not give them to T11 and T02 balances against them.

**Result:** two files, `items.test.ts`. **Proof:** A9, A9n.

### M7. `createWorld`, purity, benchmark

**Goal:** the factory, the purity gate, and the numbers. **Work:**

`index.ts`: validate, then compose `createNoise`, `createZones`, `createHeight`, `createScatter`, `createItems`. Export `createWorld` only.

`purity.test.ts`, on the real factory. Row comparison is byte-for-byte, including the tail:

| Test | Method |
|---|---|
| Repeat | Same call twice |
| Visit order | 300 chunks at each of 0, 2^20, `floor(1e15 / 64)`, `CHUNK_LIMIT - 300`, in forward, reversed and seeded-shuffle order, with `height`, `zoneAt` and `fillItems` calls interleaved to thrash the memos |
| Fresh instance | A row from a world that has run 1000 other calls equals one from a new world |
| Two seeds interleaved | Seed 1985 and seed 7 alternating equal each run alone, so no state is shared at module level |
| Dirty output | Row pre-filled with `NaN` and row pre-filled with 7 give identical results |
| No clock or randomness | `vi.spyOn` on `Math.random`, `Date.now`, `performance.now`: not called, and returning other values changes nothing |
| Period | `periodChunks = 1024`: chunk `k` and `k + 1024 * 2^37` give identical `fillProps`, `fillItems`, `height`, `zoneAt` and `bendAt` values, and `out.chunk` differs as passed |
| Aperiodic difference | `periodChunks = 0`: the same pair differs, proving the previous test is not vacuous |
| Limit | `CHUNK_LIMIT - 1` and rows up to 94 chunks ahead: no NaN, all ranges hold, height non-flat |
| Options | `createWorld` throws `RangeError` on seed 1.5, NaN, period 12, -8 |

Goldens for scatter use `support/frozenTable.ts`, a literal copy of the quota, placement and sag tables, passed to `createScatter`. That checks the algorithm stays put while T11 retunes the real table. Item goldens use the real `fillItems`, which T11 does not own. Record the FNV-1a digests over 200 rows in the test on first green, and say so in Progress. They are per engine (§5.1).

`perf.test.ts`. Every test passes its own `timeout`: Vitest's default is 5 s [M], and the rehearsal's allocation test took 4.9 s [O].

**Allocation probe** [O: calibrated]: `setFlagsFromString('--expose-gc')`, `gc = runInNewContext('gc')`, warm up 3000 calls, `gc()`, then read `heapUsed` before and after 20,000 calls, with no GC at the end, so garbage counts. Take the median of 4 runs. Calibration under Vitest forks: empty function .01 to .4 B/call, plain hash and write .3, one leaked object 32.0, one leaked 3-array 72.0. Gate: under 4 B per call, for `fillProps`, `fillItems`, `zoneAt` and `bendAt`. A `height` row is printed, and gated against a leak at under 8 B per sample, a quarter of one leaked object, with sub-windows of 40 rows (5160 samples) so a leak cannot hide behind a scavenge (repair R1, section 11). Chromium is T09's gate (DI-16), where T09 read 50.3 to 60.3 [O]. Negative controls in the same file: the probe on a wrapper leaking one object per call must read above 16, and the height probe, with its own rows, warm-up and sub-window, on a row leaking one object per sample must read above 16 B per sample. `settled()` prints every attempt's reading on one `ALLOC attempts` line per probe, so a pass after a retry shows in the log.

Measure one `height` row in a throwaway Chromium page by T09's method, `usedJSHeapSize` windows under `--enable-precise-memory-info`, as written and with `oct` and `gradP` inlined into the octave loop. Keep the lower if every golden and rule test is byte-identical, and paste both numbers into section 10.

**Benchmark, always on (sanity):** 2000 warm rows, 2000 measured, across 7 buckets: each biome's first 75 chunks, and fade rows. Only asserts `fillProps` p50 under 1 ms, so it cannot flake under sibling load.

**Benchmark, `$env:TERRAIN_BENCH = '1'`:** run on a quiet machine, after warm-up, 20,000 rows per bucket, printing one line each:

```
BENCH fillProps bucket=<name> rows=20000 records=<mean> p50us=<> p99us=<> maxus=<>
BENCH fillItems ... | BENCH zoneAt ... | BENCH heightRow level=0 and level=5 ... | BENCH refill ms=<p50> <p95>
```

| Metric | Budget [A] | Rehearsal [O] | Derivation |
|---|---|---|---|
| `fillProps` p50 | at most 60 us | 14.8 to 23.8 us, no fade | 96 rows then cost 5.8 ms of §9.2's 30 ms refill |
| `fillProps` p99 | at most 150 us | 24 to 40 us | Times 8 for a phone (§9.2) is 1.2 ms of the 2 ms streaming budget |
| `fillItems` p50 / p99 | at most 20 / 60 us | not run | Called by both sim and props, per chunk crossing |
| `zoneAt` p50 | at most 5 us | not run | Every frame, step 7 of §3.3 |
| 129-column height row, level 0 / level 5, p50 | at most 40 / 60 us | 13 / 28 us | §4.4 measured 22 us on full rows |
| Refill: 96 `fillProps` plus 768 height rows at §6.4 spacing, p95 | at most 25 ms | not run | §9.2's 30 ms, leaving 5 for uploads |

`max` is printed and not gated, since a GC or scheduler pause dominates it [O: up to 856 us]. If a budget fails under load, rerun when `check:task` of siblings is idle, and state the load in Progress.

**Result:** `index.ts`, two test files. **Proof:** A10, A10n, A11, A12.

### M8. Look at it

**Goal:** see density, variety and framing, and fix what looks wrong. **Work:**

`support/png.ts`: minimal PNG writer on `node:zlib`, RGB, filter 0, about 20 lines. `support/impostor.ts`, about 150 lines, at 960x540:

- Sky from §8.2's `skyGrad`, ported to JS on `zone.palette`. Disc per §6.1, gnomonic centre (0, .125), radius .215, with §8.2's band formula, mode 0 only.
- `sy(gy) = H/2 + (tan(CAMERA_PITCH) - gy) / tan(29 deg) * H/2`; `sx(gx) = W/2 + gx / (tan(29 deg) * W/H) * W/2`, with `gy = (y - CAMERA_Y) / z`, `gx = x / z`.
- Terrain back to front, slices `z *= 1/1.012` from 4300 to 2: per screen column, `height` at `x = gx * z`, fill downward from `sy`, shaded by height and fog, with the grid colour on 8 u lines nearer than 900 u.
- Props sorted by distance and painted between the terrain slices they fall in: an outline in a per-archetype colour, dim fill, width from a per-archetype constant times scale. Triangle for PYRAMID and OBELISK, ellipse for ORB, CRYSTAL, DOME, SAUCER, circle for RING, box otherwise.
- Exports `discOcclusion`: the fraction of disc pixels above the horizon covered by terrain over .5 u or by grounded props, not floating ones and not SEARCHLIGHT.

`preview.test.ts`: the always-on part renders 64x36 once, and asserts a valid PNG signature and more than 16 distinct colours, as a blank-image control. Under `$env:TERRAIN_PREVIEW = '1'`, it finds zones through `findZoneChunk`, writes to `test-results/T01/preview/`, and prints `SCREENSHOT <absolute path>` per file:

- `biome-<name>.png`, one each, at zone start plus 20 chunks.
- `fade-<a>-<b>.png`, 3 cases, at into = 87.
- `far-1e15.png`, Boulevard-like zone near 1e15 u, to prove the look survives distance.
- `no-keepout-neon.png`, the negative control below.
- `sheet.png`, all 36 palette and biome pairs at 320x180, 1920x1080 overall.

**Iteration is the work.** Open every PNG with the Read tool and write what you saw into Progress. Then change `biomes.ts` and repeat, until all of these hold, by eye:

1. Each biome reads as its own place from silhouettes alone. Cover the label; can you tell Olympus from Boulevard?
2. Both sides of the road are populated from near to far, with no bald slope and no empty stretch between shoulder and skyline.
3. The play window, `abs(x) <= 40`, stays clear except for the ring. The foreground must not feel cluttered.
4. The sun is framed in five biomes. In Cyber Canyon the walls are dramatic and the sun is still recognisable.
5. Fades look like a transition, not a glitch or a sparse patch.
6. On the sheet, no palette and biome pair is muddy or unreadable. Five of the six palettes have never been seen (§6.8), so note any that look wrong, for T11.

Do at least one change-and-re-view pass, even if the first view seems fine, and record what changed. What the rehearsal saw on its six biome shots [O: viewed]: a fine banded sun in a clean V; Neon City a wall of towers both sides, stepping up the slopes; Canyon's high hatched walls with spires crossing the disc's lower edge, as its exemption allows; Olympus sparse until PYRAMID and OBELISK far quotas were raised and TOTEM and COLONNADE bands widened; Boulevard and Olympus mountains bare in the middle distance, because of the keep-out finding in section 10. The rehearsal's outlines were much wider than T05's meshes will be, so density reads higher there than it will in the game [I].

**Limits, stated plainly:** this is a guide to placement, not a render. It has no shaders, bend, bloom, mirror or real meshes. Beauty is judged at T05 and T11.

**Result:** images viewed, `biomes.ts` tuned, floors in M5 updated by Decision log only if a look fix required it. **Proof:** A13, A13n.

### M9. Mutation drills and hand-off

**Goal:** show the gates fail on real regressions in production files. **Work:** run section 6's drills, paste each failure line into Progress, restore, confirm green. Then `check:task`. **Result:** evidence and a plan ready for `done`. **Proof:** A14, A15, A16.

## 6. Concrete steps

PowerShell 5.1, in `C:\highsierralabs\terrain`, no `&&`. Tests are named so `-t` can select them.

```powershell
# M1 to M6, per milestone
npx vitest run tests/unit/world/noise.test.ts
npx vitest run tests/unit/world/palettes.test.ts tests/unit/world/zones.test.ts
npx vitest run tests/unit/world/height.test.ts
npx vitest run tests/unit/world/keepout.test.ts tests/unit/world/grounding.test.ts
npx vitest run tests/unit/world/scatter.test.ts tests/unit/world/density.test.ts --reporter=verbose
npx vitest run tests/unit/world/items.test.ts

# Any time; siblings may be half-written
npm run check:task -- T01

# M7. The default reporter hides stdout from passing tests [O]; --reporter=verbose shows it.
npx vitest run tests/unit/world/purity.test.ts
npx vitest run tests/unit/world/perf.test.ts --reporter=verbose
$env:TERRAIN_BENCH = '1'; npx vitest run tests/unit/world/perf.test.ts --reporter=verbose; Remove-Item Env:TERRAIN_BENCH

# M8. Then open every SCREENSHOT path with the Read tool.
$env:TERRAIN_PREVIEW = '1'; npx vitest run tests/unit/world/preview.test.ts --reporter=verbose; Remove-Item Env:TERRAIN_PREVIEW
```

**Drill pattern** for M9. Run one at a time, and only on T01's files:

```powershell
$b = "$env:TEMP\t01-drill"; New-Item -ItemType Directory -Force $b | Out-Null
Copy-Item src\world\noise.ts $b\noise.ts -Force
# edit src\world\noise.ts with the Edit tool, per the table
npx vitest run tests/unit/world/noise.test.ts -t "per octave"     # must FAIL
Copy-Item $b\noise.ts src\world\noise.ts -Force
npx vitest run tests/unit/world/noise.test.ts                     # must pass again
```

| # | File | Edit | Must fail, with this test name |
|---|---|---|---|
| D1 | `noise.ts` | First line of `gradP`: `if (iz > 2147483647) return 0;`, the same threshold as the int32 mutant [I] | `per octave non-flat at 1e12`, `at 1e15`. `at 1e9` still passes, which is the point |
| D2 | `noise.ts` | In `oct`, after `fz` is set: `fz = (iz * zs + zLocal) / wl; fz -= Math.floor(fz);` | `fine step at 1e15` |
| D3 | `noise.ts` | In `hsh`: replace `Math.imul(hi, 0x85EBCA77)` with `0` | `no high-word alias` |
| D4 | `height.ts` | Drop `zLocal` from the row memo key | `visit order`, `split independence` |
| D5 | `scatter.ts` | Replace the yaw draw with `Math.random() * 6` | `visit order`, `no clock or randomness` |
| D6 | `scatter.ts` | Skip reducing `c` by `periodChunks` | `period` |
| D7 | `biomes.ts` | Multiply Olympus's COLONNADE and TOTEM quotas by .1 | `density` floors for Olympus |
| D8 | `keepout.ts` | `fitKeepOutAt`, the register form scatter runs, returns at once | `keep-out holds`, and `disc occlusion` |
| D9 | `grounding.ts` | Remove the float rejection | `no floating object` |
| D10 | `scatter.ts` | Add `lastLeak = { w };` inside the archetype loop, with `let lastLeak: unknown` in the factory closure | `allocation` |
| D11 | `items.ts` | Place SPIKE at `x = laneX` | `solvable road` |
| D12 | `zones.ts` | Remove the first-entry swap | `zones never repeat` |
| D13 | `grounding.ts` | In `gateRejects`, delete the mostly-buried line | `no mostly buried object` |
| D14 | `scatter.ts` | `sgn = (sideBase & 1) === 1 ? 1 : -1`, every candidate of a row on one side | `sides alternate candidate by candidate inside every row` |
| D15 | `keepout.ts` | `room = absX * k / C * 1.1 - y`, 10% lenient with K unchanged | `keep-out holds` |
| D16 | `height.ts` | `at` keeps one new object per call (`leakH = { iz }`) | `a height row is printed, and gated against a leak, under 8 B per sample` |
| D17 | `noise.ts` | `ridged`'s row key ignores `zLocal`; then, one run each, ignores `zs`, ignores `iz` (repair R2) | `the row cache cannot change a result`, on its `zLocal`, `zs` or `iz neighbour` line |
| D18 | `biomes.ts` | `KEEPOUT_K = 0.06`, a sanctioned T11 retune, not a fault | Must **pass**: all of `tests/unit/world` stays green |

## 7. Validation and acceptance

Paste short output into Progress as each passes. All values must come from this project's code. Numbers tagged [O] are the rehearsal's and are expected, not evidence.

| # | Command or action | Expected |
|---|---|---|
| A1 | `npx vitest run tests/unit/world/noise.test.ts` | All pass. Goldens by `toBe`. For each of wl 512, 256, 128, 64, 32 at 1e9, 1e12, 1e15: `range >= .5`, `zeroFrac < .01`, `eqStep < .01`, `outOfBounds = 0`. Also at `1.8e16`. `no high-word alias`: 0 of 500 equal at each wl. Period: equal at `iz` and `iz + P * (wl / 2)` with `P = 1024 * 64 / wl` |
| A1n | Same file, mutant cases | `octInt32` passes the rules at 1e9 for all wl, and fails `range` for wl 256 to 32 at 1e12 and all wl at 1e15. `octNaive` passes `range` and fails `eqStep` at 1e15. `octLoHash` gives 500 of 500 equal. A case failing to detect its mutant fails the test |
| A2 | `npx vitest run tests/unit/world/palettes.test.ts` | Linear endpoints equal the §6.8 hex conversion within 1e-6. At `m = 0` and `m = 1` the mix equals the endpoints within 1e-6. All 30 ordered pairs, 21 steps: finite, in `[0, 1]`. Sunset Drive's `horizon` (#FD3777) linear value is .98225, .03820, .18447 within 1e-4 [O]. `writePalette` length 21. Grid and accent slots, all 30 ordered pairs, m = .25, .5, .75: sRGB saturation at least .40 [arithmetic: worst .41]. Negative control: a straight OKLab mix in the test reads worst under .25 [arithmetic: .18] |
| A3 | `npx vitest run tests/unit/world/zones.test.ts` | `zones never repeat`: 100,000 zones, 0 adjacent repeats of biome, palette, hero, objective, including at block edges and from `2^40`. All 36 pairs within 600 zones. `biomeMix` 0 at into 75, in `(0, 1)` at 87.5, and continuous across the zone edge: A of the next zone equals B of this one, for all four fields. `palette` continuous across a zone edge within 1e-3. `dayPhase` in `[0, 1)`. `abs(bend.a) <= 8e-5`. `objectiveTarget` per table and feasible: GATES at most 33, NO_HIT at most 6400. `findZoneChunk` returns a chunk whose zone has those A values |
| A3n | Same file | `zoneAt` with permutation repair bypassed through a test-only copy of `entry` finds repeats (over 1000 in 100,000), proving the detector |
| A4 | `npx vitest run tests/unit/world/height.test.ts` | `heightWith` goldens by `toBe`. Exactly 0 at `abs(x) <= 85`, for all biomes and at all distances. `split independence`: 7 spacings 2 to 128, at bases 0, zone edges, 2^20, `floor(1e15 / 64)`, 2^47, `2^48 - 1025`: `toBe` equal, 0 mismatches. `height non-flat`: `heightWith` on Boulevard params, and the real `height`, at 1e9, 1e12, 1e15, columns 150, 515, 1000, 2000, 2000 samples: on Boulevard params, range at least 5 u at 150 [O: 6.9 to 7.3] and at least 40 u at the others [O: 120 to 309]; on the real height, range above 0 at 150 and at least 20 u at the others. §5.2 statistics on Boulevard params: p50 within 15% at all six columns, 20,000 samples. V rule: p95 / abs(x) at most .30 for all non-Canyon biomes at every column; Canyon at least .40 at 300. Neon City p50 at 1000 under Boulevard's, Desert's under Neon's. `adjacent rows`: across every zone edge in 60 zones, change across a .0002 u step at most .01 u [O: .0014]. Worst change over one 2 u row anywhere, at most 20 u [O: 15.2]. `chunk edge`: through a Boulevard to Canyon fade, mean row step on chunk-edge rows at most 1.2 times other rows [O: 1.02] |
| A4n | Same file | A test-only height with mix stepped per chunk reads at least 1.5 on the `chunk edge` metric [O: 2.16]. The worst-step check cannot tell them apart [O: 12.05 against 12.00], which is why the mean ratio is the gate |
| A5 | `npx vitest run tests/unit/world/keepout.test.ts` | `keep-out holds`: over 2000 rows of every biome, for every grounded, non-exempt record with `abs(x) < C * FOG_END`: `y + top * scale <= abs(x) * KEEPOUT_K / KEEPOUT_C + 1e-3`, both read from `biomes.ts` (4.8 at the shipped K), so a T11 retune moves the limit with it (D18). All scales at or above .5. Canyon records may exceed, and do: at least one must, else the exemption is dead code |
| A5n | Same file | `disc occlusion`: `discOcclusion` at 5 positions per biome: at most 10% for the five non-Canyon biomes [O: 4.0 to 7.6%]. Canyon reported, not gated [O: 22.5%]. Negative control, Neon City with a test table where `KEEPOUT_K` is 5: at least 15% [O: 24.3%]. If that fails to rise, the metric is dead |
| A6 | `npx vitest run tests/unit/world/grounding.test.ts` | `levelAt` agrees with §6.4's extents. `spacingAt` doubles past ratio .6. `coarseSurface` equals `height` exactly at a lattice corner. `sag calibration`: per class, band and spacing 8 to 64, measured absolute p95 at most 1.15 times `SAG`, 20,000 samples. On failure it prints the new table in paste-ready form. `no floating object`: 2000 rows per biome, each grounded record at `abs(x) > 85`: `coarseSurface - drop >= y - root * scale`, and for all records above `abs(x) = 500`: `top >= 40` and `root >= 20`, floating excepted. No grounded record at `abs(x)` between 520 and 1040 (§5.7 rule 4). `no mostly buried object`: same rows, each scattered grounded record at `abs(x) > 85`: `coarseSurface - drop - y <= .7 * top * scale + 1e-3`, 0 in every biome over at least 50,000 records. PYLON, a fixed line, is printed and not gated |
| A6n | Same file | A test table with a tiny root sees rejections rise, and with `SAG` 0 and the gate off finds floating records, proving the check sees them. A Canyon table with `top` times 1e6, where the bury rule cannot fire, finds over 100 buried records. D13 removes the rule alone |
| A7 | `npx vitest run tests/unit/world/scatter.test.ts` | Schema over 5000 rows, all biomes, fade rows, at 0, 1e9, 1e15, `CHUNK_LIMIT - 1`, after Float32 storage: `start` non-decreasing, `start[20] <= MAX_PROPS_PER_CHUNK`, count of `a` at most `ARCHETYPE_SPEC[a].perChunk`, `zLocal` in `[0, 64)` and non-decreasing inside an archetype, `keep`, `tintSeed`, `variant` in `[0, 1)`, `scale > 0`, all finite, tail zero, `out.chunk` as passed. No record at `abs(x) < 44` except RING. Per-archetype rules of section 4: RING only on multiples of 48, with its exact fields. PYLON 0 or 2, x exactly 100, y 0, `zLocal` 0, `keep` .1 and .6, `variant` exactly .75 when the next row has a pair, otherwise .25. REFLECTOR exact x, even count. SEARCHLIGHT only on multiples of 6. Facing yaw sign opposite to x. Left and right per archetype within 5% over 2000 rows. `sides alternate candidate by candidate inside every row`: on 1000 pure rows per biome at 0 and at 1e15, with `n` recomputed from the row dither, each record's slot `floor(zLocal * n / 64)` rises, side times `(-1)^slot` is one constant per archetype per row, and left and right differ by at most 1 plus the rejected count; over 20,000 archetype rows with 2 or more records. Scatter golden digest, frozen table |
| A7n | Same file | Schema checker fed a hand-corrupted row (`start` out of order, `keep = 1`, `zLocal = 64`) reports each, proving it can fail |
| A8 | `npx vitest run tests/unit/world/density.test.ts --reporter=verbose` | All floors in M5's table, printing one `DENSITY biome=<name> ...` line per biome with the measured values. Same floors in a fade between every ordered biome pair (30 fades, row total and live count) |
| A8n | Same file | Metrics on a test table with quotas times .1 fail the row-total and column floors, and a table with Olympus copied from Boulevard fails biome identity |
| A9 | `npx vitest run tests/unit/world/items.test.ts` | Schema over 5000 rows per difficulty: count at most 32, per-kind caps, ranges, tail zero, `count` right, kind order, z order in kind. Gates on every multiple of 3 with `abs(x) <= 26` and `a = 0`, except where a checkpoint stands. Exactly one checkpoint per zone, `a = 1`, at `c % 100 === 0`. No fence within 32 u before a gate. Shards exactly on the 12 u lattice at `2^40 + 1`. `a` at most `TRAFFIC_TRAVEL_MAX`, `b` integer, `a * b / 256` in 20 to 40. `zLocal + a < 192`. Drone `abs(x) + a <= 40`. `solvable road`: over 5000 chunks at zones 0, 6, 12, 40, a straight path between lane nodes at y = 8, radius 2, threads every gate, passes every fence gap with `b` narrowed by 2, and touches no spike, no full-amplitude drone, no traffic. Mean shards per chunk at least 3. Mean hazards per zone rise from zone 0 to 12, and from 12 to 40 stay flat within 15%. Item golden digest |
| A9n | Same file | The `solvable road` checker with a hazard forced onto the lane reports a hit |
| A10 | `npx vitest run tests/unit/world/purity.test.ts` | Every row of M7's table passes. `Aperiodic difference` over 100 bytes differ |
| A10n | Drills D4, D5, D6 | Each fails the named test, restored after |
| A11 | `npx vitest run tests/unit/world/perf.test.ts --reporter=verbose` | Under 4 B/call on `fillProps`, `fillItems`, `zoneAt` and `bendAt`, and a `height` row under 8 B per sample, all printed, with one `ALLOC attempts` line per probe listing every attempt's reading. Leak control above 16 B/call, and the height probe's leak control above 16 B per sample. Sanity p50 under 1 ms. M7's two Chromium `height` numbers are in section 10 |
| A12 | `TERRAIN_BENCH` run in section 6 | One `BENCH` line per metric, within budget, on a quiet machine. Paste them all, with the load state |
| A13 | `TERRAIN_PREVIEW` run in section 6 | All listed PNGs written. **Open each and write what you saw into Progress**, against the 6-point list. Record what you changed |
| A13n | `no-keepout-neon.png` | Towers visibly rise across the disc's lower part, unlike `biome-neon-city.png`. `far-1e15.png` looks like a normal zone: not flat, not empty |
| A14 | Drills D1 to D17, and D18 | D1 to D17 each fail with their named test and pass after restore; D18 passes. One pasted line each |
| A15 | `npm run check:task -- T01` | Exit 0, all gate lines non-vacuous. Then `npm run plans:check` shows no overlap for T01 |
| A15n | With a sibling mid-flight | Unaffected, per T00's fixture. No extra action |
| A16 | `npm run check`, after the batch | Exit 0. If a sibling's file breaks it, that is theirs to fix: report, do not edit |

## 8. Idempotence and recovery

- All test commands are safe to re-run. They write only under `test-results/T01/` and touch no other task's path.
- Clean state: `Remove-Item -Recurse -Force test-results\T01 -ErrorAction SilentlyContinue`. T01 runs no server and no Playwright.
- Drills edit production files. Restore from `$env:TEMP\t01-drill`, then confirm by rerunning that file. Never leave one in place across a stop. If a session dies mid-drill, the Progress line says which, and the backup is still there.
- There is no git. Before a risky rewrite of `scatter.ts`, copy it to `$env:TEMP\t01-backup`. A failed design goes back to the plan, per Agents.md.
- Goldens: if `noise.ts` or `heightWith` goldens fail, the code is wrong, since §4.4 is the source. Scatter and item digests may change only by a Decision log entry saying why.
- A retune that fails a floor is reverted or logged, per Agents.md's rule on thresholds.

## 9. Progress

- [x] 2026-11-05T06:32Z Plan drafted. A throwaway rehearsal ran in the scratchpad, and no project file exists from it.
- [x] 2026-11-05T14:52Z M0 Read Agents.md, this plan, architecture.md §4 and §5, §6.1, §6.4, §6.5, §6.8, §8.1, §8.2, `src/contracts/index.ts`, `src/core/{hash,coords,motion,alloc}.ts`, `scripts/check-task.ts`, `eslint.config.js`. `npm run contracts:check` printed `contracts:check PASS, 7 files`, exit 0. `npm run check:task -- T01` printed `tsc: VACUOUS` / `eslint: VACUOUS` / `vitest: VACUOUS` / `check:task T01 FAIL`, exit 1, the correct state with no files.
- [x] 2026-11-05T14:53Z M1 Noise, with mutants. A1, A1n: `noise.test.ts` 20 passed on first run, all 7 goldens by `toBe`, `octInt32`, `octNaive`, `octLoHash` each caught.
- [x] 2026-11-05T14:56Z M2 Palettes, biomes, zones. A2, A3, A3n: `palettes.test.ts` and `zones.test.ts` 20 passed. Worst grid and accent saturation at least .40 by shortest hue, straight OKLab control under .25. 0 repeats in 100,000 zones from 0 and from 2^40, control over 1000.
- [x] 2026-11-05T14:57Z M3 Height. A4, A4n: `height.test.ts` 20 passed on first run, all 7 goldens, the §5.2 table, the V rule, `chunk edge` under 1.2 with the stepped control at least 1.5.
- [x] 2026-11-05T15:14Z M4 Keep-out, grounding. A5, A5n, A6, A6n. `OCCLUSION biome=0 mean=7.2% worst=8.0% | biome=1 mean=5.8% worst=6.5% | biome=2 mean=4.1% worst=4.3% | biome=3 mean=21.8% worst=23.0% | biome=4 mean=6.8% worst=6.9% | biome=5 mean=7.0% worst=8.3%`, Canyon reported, not gated. `OCCLUSION no keep-out Neon City worst=30.4%`. `sag calibration` within 1.15 of the table on every cell.
- [x] 2026-11-05T15:42Z M5 Scatter and density floors. A7, A7n, A8, A8n. Final lines of the last run, table as tuned in M8:
  ```
  DENSITY biome=Boulevard rowMin=53 near=8.80 rise=6.17 far=3.02 fill=0.996 searchlight=1.000 live=993 columnMin=2 columnMean=8.4 centreMean=61.7
  DENSITY biome=Neon City rowMin=42 near=3.00 rise=8.00 far=5.16 fill=1.000 searchlight=1.000 live=862 columnMin=3 columnMean=11.0 centreMean=53.4
  DENSITY biome=Crystal Desert rowMin=37 near=4.67 rise=13.06 far=2.28 fill=1.000 searchlight=1.000 live=807 columnMin=1 columnMean=8.5 centreMean=49.5
  DENSITY biome=Cyber Canyon rowMin=47 near=0.26 rise=9.77 far=2.08 fill=0.977 searchlight=0.912 live=901 columnMin=2 columnMean=7.9 centreMean=49.7
  DENSITY biome=Orbital Night rowMin=39 near=1.03 rise=10.40 far=2.56 fill=0.993 searchlight=1.000 live=810 columnMin=1 columnMean=7.2 centreMean=48.8
  DENSITY biome=Olympus rowMin=38 near=8.59 rise=9.98 far=2.41 fill=0.994 searchlight=1.000 live=810 columnMin=2 columnMean=8.1 centreMean=61.5
  DENSITY identity worst=0.586 Cyber Canyon and Orbital Night
  DENSITY fades=30 rowMin=34 liveMin=821
  ```
- [x] 2026-11-05T15:41Z M6 Items, last run. A9, A9n: `items.test.ts` passes, `solvable road` over 20,000 chunks, 0 hits, forced spike reported. `HAZARDS per block zone0=1174 zone12=3059 zone40=3037`.
- [x] 2026-11-05T15:42Z M7 `createWorld`, purity, benchmark. A10: every row of the purity table passes, by the final run of 115 tests over the 10 non-perf, non-density files. A11 and A12, all of it under sibling load, CPU reading 33% just after the run:
  ```
  ALLOC B/call fillProps near=2.01 far=1.00 fillItems near=0.00 far=0.00 zoneAt=0.00 bendAt=0.89
  ALLOC B/sample height=1.37
  ALLOC leak control=32.20
  BENCH fillProps bucket=Boulevard rows=20000 records=54.0 p50us=13.5 p99us=22.7 maxus=216
  BENCH fillProps bucket=Neon-City rows=20000 records=42.2 p50us=14.7 p99us=25.3 maxus=600
  BENCH fillProps bucket=Crystal-Desert rows=20000 records=37.0 p50us=12.8 p99us=18.4 maxus=94
  BENCH fillProps bucket=Cyber-Canyon rows=20000 records=48.1 p50us=12.7 p99us=23.2 maxus=136
  BENCH fillProps bucket=Orbital-Night rows=20000 records=40.0 p50us=8.9 p99us=13.7 maxus=120
  BENCH fillProps bucket=Olympus rows=20000 records=39.0 p50us=13.9 p99us=18.4 maxus=85
  BENCH fillProps bucket=fade rows=20000 records=43.4 p50us=13.8 p99us=24.2 maxus=97
  BENCH fillItems rows=20000 records=11.1 p50us=1.4 p99us=2.7 maxus=225
  BENCH zoneAt rows=20000 p50us=1.4 p99us=2.3 maxus=208
  BENCH heightRow level=0 rows=20000 p50us=8.7 p99us=14.8 maxus=319
  BENCH heightRow level=5 rows=20000 p50us=16.1 p99us=32.3 maxus=580
  BENCH refill ms=13.07 16.44
  ```
  Goldens recorded at first green, per engine: scatter on the frozen table `near=519618140 far=911465691`, items `near=928456839 far=2782424726`.
- [x] 2026-11-05T15:25Z M8 first look, all 12 images opened. A13, A13n. What each showed:
  - `biome-boulevard`: banded sun in a clean V, ring small at the horizon. Green palm boxes and yellow billboards close along both sides, arcologies behind them. Upper slopes mostly bare hatching with few towers. Road empty.
  - `biome-neon-city`: orange towers stepping up both slopes to the skyline, blue obelisks in the middle distance, a dense wall. Sun clear.
  - `biome-crystal-desert`: round teal crystals of many sizes, cactus boxes, gold pyramids. The ring was close enough to overlap the disc, which is what a ring does as you near it.
  - `biome-cyber-canyon`: high hatched walls taking the upper corners, spires and turbines high on them, a narrow slot of sky. Sun recognisable, with spires crossing its lower edge, as the exemption allows.
  - `biome-orbital-night`: saucers scattered across the sky, a few crossing the disc, which the rules allow for floating objects. Obelisks, dishes and domes on the ground.
  - `biome-olympus`: pale columns, domes and pyramids. One large dome on the left stands out near the road, a sphere in the impostor, half of it in T05's mesh. Reads differently from Boulevard.
  - `no-keepout-neon`: towers climb right across the lower disc, plainly unlike `biome-neon-city`. A13n holds.
  - `far-1e15`: Arctic Laser on a Boulevard zone. Not flat, not empty, the same structure as near the origin. A13n holds.
  - `fade-boulevard-cyber-canyon`: palms in front with walls rising behind, indigo sky and a mint sun at the palette midpoint. Saturated, not grey. `fade-neon-city-orbital-night`: towers thinning into orbs and domes, saucers arriving, a pale green sun on blue. `fade-crystal-desert-olympus`: both sets mixed, a ring arc close to the camera. None looks sparse or broken.
  - `sheet`: all 36 pairs distinct. None muddy or unreadable. For T11: on Toxic Arcade the disc top almost merges into its cyan halo. Ember's dark red sky is the closest to its red terrain lines of the six. A palette midpoint can land on a sun colour neither end has, such as mint.
- [x] 2026-11-05T15:31Z M8 change and re-view. Boulevard's upper slope read bare, so Boulevard's ARCOLOGY quota went from 2 to 3 and OBELISK from 1 to 2, which adds far silhouettes. Reopened `biome-boulevard`, `fade-boulevard-cyber-canyon`, `far-1e15` and `sheet`: more towers and spires on both slopes and on the skyline, sun framing unchanged at 8.0% worst occlusion. The upper slope is still the emptiest part of the picture, and that is the keep-out's known cost (section 10), not something a quota can remove below 1040 u. After later code changes all 12 PNGs are byte-identical by md5.
- [x] 2026-11-05T15:41Z M9 Drills. A14, by `drills.mjs` in the scratchpad, each edit restored from a copy, and each file green afterwards (`drills done, not as required: 0`):
  ```
  D1 per octave non-flat at 1e12 :: range at 1000000000000 wl 256: expected 0 to be >= 0.5 || at 1e15 :: wl 512 || at 1.8e16. at 1e9 still passes
  D2 fine step at 1e15 :: eqStep at 1000000000000000 wl 512: expected 0.8748778103616813 to be less than 0.01
  D3 no high-word alias :: aliased samples at wl 512: expected 500 to be +0
  D4 split independence :: expected 207.10146560000763 to be 207.32453501534886 || visit order :: height after a neighbour at 0 + 299: expected 72.9627940109301 to be 72.8777882159101
  D5 visit order :: reversed at 0 + 299: expected false to be true || no clock or randomness :: expected "random" to not be called at all, but actually been called 3908 times
  D6 period :: props at 0: expected false to be true
  D7 every biome is full, near to far :: Olympus row total: expected 26 to be >= 32
  D8 keep-out holds :: expected 30603 to be +0 || disc occlusion :: biome 0: expected 0.2515467274503419 to be <= 0.1
  D9 no floating object :: floating records in biome 0: expected 398 to be +0
  D10 allocation :: fillProps: expected 600.02 to be less than 4
  D11 solvable road :: expected [ 'spike hit at 0', ...(19) ] to deeply equal []
  D12 zones never repeat :: expected 15862 to be +0
  ```
- [x] 2026-11-05T15:45Z A15 `npm run check:task -- T01`: `tsc: 33 owned files, 2 configs, 0 problems`, `eslint: 33 owned files, 0 errors, 0 warnings`, `vitest: 13 owned files, exit 0`, `glsl: 33 owned files scanned, 0 hits`, `check:task T01 PASS`, exit 0. `npm run plans:check`: `12 plans, 2648 pattern pairs, 0 problems`, exit 0.
- [ ] A16 whole-repo `npm run check`: not run by T01. The batch orders it held until all siblings finish. Per DI-64 the T00 owner ran it after batch 1: typecheck and lint clean, 1627 passed, 2 failed (T03 `layer.test.ts:357`, T05 `alloc.test.ts:83`), none in T01's paths. T01 counts as done for T10 only after the post-repair whole-repo run is green, which the T00 owner runs.

**Repair R1, after the V1 verdict (passed, 0 blocking, 5 low defects for T01).** Scratch: `C:/Users/<user>/AppData/Local/Temp/claude/802ff760ce0bdd56/d050f826-f2f3-4f5f-ab68-28447d8d5879/scratchpad/T01/` (`mutate.mjs`, `before-fix.log`, `after-fix.log`, `retuneKAll.log`, `backup0/`). Each mutation is applied, run, restored from the original bytes and its md5 compared to the pre-mutation hash.

- [x] 2026-11-05T20:03Z Baseline `npm run check:task -- T01`: 129 passed, 2 skipped, `check:task T01 PASS`, exit 0. Owned files copied to `backup0/` with md5s.
- [x] 2026-11-05T20:05Z Before any fix, the five gaps reproduced against the old tests:
  ```
  bury (E10, D13)     grounding.test.ts: 9 passed, 0 failed
  side (E13, D14)     scatter + density: 17 passed, 1 failed, only 'a digest of 200 rows on the frozen table'
  retuneK (D18)       keepout.test.ts: 'keep-out holds' expected 29883 to be +0, and 'fits a tall one' expected 2.4 to be close to 2
  heightLeak (E49)    perf.test.ts: 4 passed. ALLOC B/sample height=0.86 with one leaked object per sample
  rowKey (E20)        noise.test.ts: 22 passed, 0 failed
  ```
  every file restored, md5 matches.
- [x] 2026-11-05T20:09Z Fixes, test files only, no `src/world` file changed (all 12 md5 equal to `backup0/`): `grounding.test.ts` adds `no mostly buried object` and its control; `scatter.test.ts` adds `sides alternate candidate by candidate inside every row`; `keepout.test.ts` derives every limit from `KEEPOUT_K / KEEPOUT_C`; `noise.test.ts` asserts the zLocal, zs and iz neighbours; `perf.test.ts` and `support/alloc.ts`: `settled()` prints every attempt, the height probe uses 40-row sub-windows and an 8 B/sample ceiling, and a height-probe leak control is added.
- [x] 2026-11-05T20:10Z The first `no mostly buried object` run failed: `expected 163 to be +0` in Canyon, all 163 PYLON (`3=163(a6:163)`). PYLON is a fixed line, not a placed candidate (section 4, S-04), so the gate counts scattered records and prints PYLON. See sections 10 and 11.
- [x] 2026-11-05T20:11Z After the fixes, each mutation fails its new check:
  ```
  bury        FAIL no mostly buried object :: mostly buried records in biome 0: expected 1086 to be +0
              BURY scattered buried per biome 0=1086 1=1019 2=333 3=2423 4=659 5=1073 checked=97401
  side        FAIL sides alternate candidate by candidate inside every row :: 151878 problems
  retuneK     keepout.test.ts 6 passed, 0 failed  (and retuneKAll: all of tests/unit/world 133 passed, 2 skipped)
  lenientK    FAIL keep-out holds :: expected 29184 to be +0
  d8          FAIL keep-out holds :: expected 30603 to be +0 (and 4 more, disc occlusion 0.2515)
  heightLeak  FAIL a height row ... under 8 B per sample :: expected 27.22517829457364 to be less than 8
              ALLOC attempts height limit=8.00 readings=27.24,27.23,27.23,27.23 FAIL
  rowKey      FAIL the row cache cannot change a result :: zLocal neighbour at 0: expected 0.6145084391340293 to be 0.6082584051390304
  d10         ALLOC attempts fillProps-near limit=4.00 readings=480.48,480.51,480.63,480.05 FAIL
  ```
  every file restored, md5 matches its pre-mutation hash.
- [x] 2026-11-05T20:12Z `npx vitest run tests/unit/world --reporter=verbose`: 133 passed, 2 skipped, exit 0. Goldens unchanged (`scatter near=519618140 far=911465691`, `items near=928456839 far=2782424726`), DENSITY and OCCLUSION lines identical to M4 and M5 above. New lines:
  ```
  ALLOC attempts fillProps-near limit=4.00 readings=1.26 pass
  ALLOC attempts fillProps-far limit=4.00 readings=0.67 pass
  ALLOC attempts fillItems-near limit=4.00 readings=22.35,0.05 pass
  ALLOC attempts fillItems-far limit=4.00 readings=11.12,0.02 pass
  ALLOC attempts zoneAt limit=4.00 readings=0.02 pass
  ALLOC attempts bendAt limit=4.00 readings=0.61 pass
  ALLOC attempts height limit=8.00 readings=0.04 pass
  ALLOC leak control height=27.23
  ALLOC leak control=32.03
  BURY scattered buried per biome 0=0 1=0 2=0 3=0 4=0 5=0 checked=97173 | pylon, fixed line, reported only: 1=0/4000 3=163/4000 4=0/4000
  BURY control buried=3625
  ```
- [x] 2026-11-05T20:12Z `npm run check:task -- T01`: `tsc: 33 owned files, 2 configs, 0 problems`, `eslint: 33 owned files, 0 errors, 0 warnings`, `vitest: 13 owned files, exit 0` (133 passed, 2 skipped), `glsl: 33 owned files scanned, 0 hits`, `check:task T01 PASS`, exit 0.
- [x] 2026-11-05T20:13Z No image: the repair changed no production file, so the 12 previews are unaffected and were not re-rendered.

Remaining: A16, held by the T00 owner (DI-64). A12 on a quiet machine, as before. Nothing else in T01's paths.

**Repair R2, after the V2 verdict (passed, 0 blocking, 2 low defects for T01).** Scratch: `C:/Users/<user>/AppData/Local/Temp/claude/802ff760ce0bdd56/d050f826-f2f3-4f5f-ab68-28447d8d5879/scratchpad/T01/R2/` (`start.md5`, `backup/`, logs).

- [x] 2026-11-05T21:53Z Start. Status to in-progress. All 33 code and test files md5-equal to V2's `start.md5`; the plan equals V2's post-note md5 `515320c2...`. `noise.ts`, `noise.test.ts` and this plan copied to `backup/`.
- [x] 2026-11-05T21:53Z Item 1 before the fix, `mutate.mjs` on `noise.ts:148`, `noise.test.ts` only, each restored to md5 `fcb15e1e...`:
  ```
  VzsKey (no rowKey[1])  exit 0, 22 passed, 0 failed: row-cache test passed (mutant escaped)
  VizKey (no rowKey[0])  exit 1, FAIL row cache, unlabelled assert: expected 0.6024332979453053 to be 0.6145084391340293
  D17    (no rowKey[2])  exit 1, FAIL row cache: zLocal neighbour at 0: expected 0.6145084391340293 to be 0.6082584051390304
  ```
- [x] 2026-11-05T21:54Z Item 1 fix in `noise.test.ts`: neighbours `(iz, 2, 1.5)`, `(iz, 4, 1.5)`, `(iz + 1, 4, 1.5)`, each one key field from the call before; the closing assert is labelled. Same mutants, each restored to md5 `fcb15e1e...`:
  ```
  VzsKey  exit 1, 21 passed, 1 failed: zs neighbour at 0: expected 0.6082584051390304 to be 0.7646216525303452
  VizKey  exit 1, 21 passed, 1 failed: iz neighbour at 0: expected 0.7646216525303452 to be 0.7181708355639319
  D17     exit 1, 21 passed, 1 failed: zLocal neighbour at 0: expected 0.6145084391340293 to be 0.6082584051390304
  clean   npx vitest run tests/unit/world/noise.test.ts: exit 0, 22 passed
  ```
- [x] 2026-11-05T21:55Z Item 2, `di69check.mjs` (each of sections 10, 11, 13 cites DI-69 and holds none of R1's open-question phrases). Before: exit 1, `section 10: DI-69 cited 0x ... FAIL`, same for 11 and 13. After the edits: exit 0, `cited 1x / 2x / 3x, phrases none`, `di69check PASS`.
- [x] 2026-11-05T21:55Z `npm run check:task -- T01`: exit 0, `tsc: 33 owned files, 2 configs, 0 problems`, `eslint: 33 owned files, 0 errors, 0 warnings`, `vitest: 13 owned files, exit 0` (133 passed, 2 skipped), `glsl: 33 owned files scanned, 0 hits`, `check:task T01 PASS`. `npm run plans:check`: exit 0, `12 plans, 2648 pattern pairs, 0 problems`. `md5sum -c start.md5`: only this plan and `noise.test.ts` differ; all 12 `src/world` files unchanged, LF kept (0 CR bytes).

Remaining: A16, held by the T00 owner (DI-64). A12 on a quiet machine, as before. Nothing else in T01's paths.
- [x] 2026-11-07T21:00Z **Reopened by the T00 owner for T11's operator review, DI-118** (status `in-progress`). The operator, verbatim: "Most of the path is left and right movements by the player. Vary the rings height off of ground. The play should feel like more a swooping path." Gates stood at y 8 with radius 9, which spans the whole play band (2 to 14), so height never mattered. Backups: scratchpad `OP1/backup`.
- [x] 2026-11-07T21:25Z **The lane gets a height.** `lanes.ts`: `laneHeight(seed, n)` and `laneHeightPair(seed, io)` (io[6], io[7], scratch io[3]), salt `0x6102`: even nodes in [8, 10), odd nodes in [11, 13), one draw per node, so every gate is 1 to 5 u above or below the one before (3 on average) with no recurrence. A first draft drew uniformly in [8, 13) per node; its own test measured 34% of steps at 2 u or more (the arithmetic is (1 - .4)^2 = 36%; the draft's expected 64% was wrong), a mean step of 1.7 u, too gentle to read as a swoop, hence the bands. The floor stays 8 because traffic (y 2.5, radius 3) is cleared by height alone. `items.ts`: gates at their node's height with radius 6 (from 9; 8 since 22:20Z, below), shards at the eased height between nodes plus pattern 2's wave, the checkpoint arch unchanged (y 8, radius 42). **An allocation found and fixed:** `perf.test` read `fillItems` at 5.29 B a call (limit 4); bisected to `checkpoint ? ROAD_Y : h0`, a conditional of an integer constant and a double, which V8 boxed; two stores instead, and the probe passes (4 passed, twice).
- [x] 2026-11-07T21:28Z **Tests.** `items.test.ts`: the solvable road flies `pathY`, the straight path between node heights, in place of the fixed y 8, and still finds no hit or miss over 20,000 chunks in four zones; gates are checked at `laneHeight` (float32), radius 6 and at least 2 u off the floor; shard heights 5.5 to 15.5; new rows for the bands and for `laneHeightPair` against `laneHeight` by toBe at 0, 2^32, 1e13 and -30. **Golden:** `ITEM_GOLDEN` was `[928456839, 2782424726]` and is `[2115507778, 3397986301]` (Decision log). `npx vitest run tests/unit/world`: 13 files, 135 passed, 2 skipped. Whole repo `npm run check`: exit 0, 119 files, 1980 passed, 2 skipped, glsl 189 files 0 hits.
- [x] 2026-11-07T22:20Z **Gate radius 8, by T05's A16b.** T05's `props.spec` failed one row at radius 6: A16b's props' shimmer share .222 against its .2 limit (.08 to .10 in earlier records). Bisected on the GPU with each file restored by hash (scratchpad `OP1/keep`): the old ship with the new world .222, the new ship with the old world .108; the heights at radius 9 .167; radius 6 at y 8 .156; with the heights, radius 7 .200, radius 8 .184; radius 8 with both bands a unit higher (9 to 14) .200. Radius 8 at the bands 8 to 13 is kept: the inner rim 0 to 5 u off the floor. Tests updated to it (radius 8, the inner rim never below the floor), golden re-recorded `[3510218, 2261875425]`; `tests/unit/world` 135 passed, 2 skipped; `perf.test` allocation 4 passed, twice. T05's whole `props.spec` on `gpu`: 40 passed, 3 skipped, A16b .184.
- [x] 2026-11-07T23:35Z **Closed under DI-118, status `done`.** `check:task T01` PASS. Whole repo `npm run check` exit 0 (119 files, 1980 passed, 2 skipped; glsl 189 files, 0 hits), `plans:check` 0 problems, `contracts:check` PASS; T10's e2e on `gpu` (all 19 spec files but `dist.spec`, the two timing specs and the no-webgl one; `TERRAIN_PORT=5110`, through the lock): 62 passed, 9 skipped, exit 0. Open for the operator: DI-118's named choices (the ledger).

## 10. Surprises and discoveries

**From the build, on project code.**

- **The natural scatter allocated 232 B per call, and items 576 B.** A sampling heap profiler (`HeapProfiler.startSampling` through `node:inspector`, interval 64) named the sites: a helper taking doubles as arguments, a coarse-surface function returning a double, and `hash01` itself once the inlining budget ran out. Inlining is a budget (TurboFan's 920 bytecode bytes per optimization [M, from V8 source memory]), so a small wrapper can be inlined while its callee is not, and then the double boxes anyway. Register passing fixed it without relying on any heuristic: helpers read and write one `Float64Array`, and only Smis and objects cross a call. Final 2.01 and 0.00 B/call.
- **One world and two worlds are different programs.** With a single world `fillProps` read 1.98 B/call. With a second `createWorld` alive it read 196, stable over retries. Bisecting by archetype found it (`reflector=64.9`, the rest near 0): `(i & 1) === 0 ? -REFLECTOR_X : REFLECTOR_X`, once per pair. Writing it as a multiply took the reading back to 1.98. The likely mechanism is that a second closure stops module constants folding, so a phi of a computed double and an untyped module const stays tagged and the double side boxes [I]. The perf test keeps two worlds alive deliberately, and clamps use `Math.min` and `Math.max`.
- **Vitest's transform cost about 3 to 5 times the plain bundle, until the imports were hoisted.** Before hoisting, under Vitest at 57% CPU: `fillProps` p50 52 us, level 5 row 28 us, refill 26 and 33 ms, over budget. The same code as a Vite bundle in plain Node at 34% CPU: 10.8 us, 10.0 us, 8.13 and 11.10 ms. The load differs, so the ratio is rough. Every read of an imported binding is a getter on a module object there [read from Vitest's output, not from its source]. Hoisting them to module-level consts gave the numbers in Progress, under load. A bundle does not pay this, so the plain numbers are the closer guide to the shipped path [I].
- **Most of a height sample was fmod and repeated z work.** `zc % 2^32` is a C call, twice per octave. `zc - hi * 2^32` is congruent modulo 2^32, so `|0` gives the same word without it, and the z half of all five octaves is now kept per row. Level 0 row 13 us and level 5 28 us before hoisting, matching the rehearsal's 13 and 28.
- **M7's Chromium measure, one height row, chromium-1234, `usedJSHeapSize` windows under `--enable-precise-memory-info`, leak control 16.16 B/call, empty .16.** As written, with `oct` and `gradP` calls: level 0 32.47 B/sample, level 5 154.29 median and 130.24 mean. Inlined: level 0 16.10, level 5 23.73. Every golden and rule test is byte-identical, so the inlined form stays. The remaining cost is about one heap number at `WorldSource.height`'s return. `fillProps` and `fillItems` read .32 B/call in the same page. The figures are per column of a 129-column row, and two thirds of a level 0 row returns early from the valley, so 32.47 is not comparable to T09's 50.3 to 60.3, which counted non-valley samples.
- **`performance.memory` is a snapshot.** `const mem = performance.memory; mem.usedJSHeapSize` never changes, and it read 0 for everything, including a leak, until the control caught it. Read `performance.memory.usedJSHeapSize` afresh each time. `src/harness/budget.ts` already does.
- **The plan's drone rule contradicted itself on an edge lane.** With `laneX` at 26 and amplitude 8, clamping to `abs(x) + a <= 40` leaves a drone 6 u from the lane, against its promise of `a + radius + 3`. And radius + 3 was not enough either: a straight line strays 2.5 u from the lane and the ship is 2 u, which needs radius + 4.5. See section 11.
- **Random sides fail the plan's 5% rule on one-per-row archetypes, and leave screen holes.** Canyon's CASSETTE read 1034 left against 917 right over 2000 rows, 6%. With the same hash Crystal Desert had `columnMin=0`. After the golden-ratio walk, every column at every position in every biome holds an object.
- **No palette slot is under the low-chroma floor.** The lowest is Toxic Arcade's top at .0224, so §6.8's "take the other end's hue" branch never runs on the shipped table. T11 could reach it by retuning.

**From repair R1.**

- **The height probe could not see a leak at any ceiling.** V1 read the 64 B/sample ceiling as 47 times too loose. It was worse: with one object leaked per `height` call, the old probe read 0.86 B/sample. Its sub-window was 5000 calls of a 129-sample row, so 645,000 samples, about 20 MB with the leak, and a sub-window that spans scavenges keeps only what came after the last one. With 40-row sub-windows (5160 samples), the same leak reads 27.23 and the gate's own leak control 27.23. The old 1.37 B/sample and the new 0.04 also differ in the accumulator, a closure `let` then, a `Float64Array` now, so the two causes were not separated.
- **Canyon pylons are mostly buried at their far reach.** `no mostly buried object` failed first on PYLON alone: 163 of 4000 Canyon records have the coarse surface (spacing 128 at a 3000 u reach) more than .7 of the 20 u mast above y = 0, and 0 of 4000 in Neon City and Orbital Night. On true height the mast is buried at most a little (section 4). The pylon is a fixed line for T05's wire (S-04), so it is reported, not gated. DI-69 settles this: accepted for now, and T11 judges the Canyon pylon lines on the real build, raising PYLON's lane in that biome or dropping the line there if they read as stumps. At 3000 u the mast is about 6 px tall at 1080p [arithmetic], which is where this happens.
- **The rewarm is load-bearing for `fillItems` on every run, not only under load.** `fillItems` read 22.35 then 0.05 B/call near, 11.12 then 0.02 far, in every run of this repair; in the D10 run 189.83 then 0.03. The steady state is clean, and a real fault stays high on every attempt (D10's `fillProps` 480.48, 480.51, 480.63, 480.05; D16's height 27.24, 27.23, 27.23, 27.23). The cold reading's cause was not looked into.
- **The keep-out's unit test hard-coded K too.** The D18 retune also failed `fits a tall one to the limit`, `expected 2.4 to be close to 2`, so the fix also derives the two K-dependent `fitKeepOut` cases, as well as `keep-out holds`. The `C * FOG_END` case at `LIMIT - 1` still holds for any K below about .122 [arithmetic: `1031 * K / .24 - 500 < 25`].

**From the 2026-11-05 rehearsal, before any project code. Each was re-measured above or in Progress where section 7 asks.**

- **A sum of octaves hides dead octaves.** With the int32 fault, at 1e12 only wavelength 512 survives (range .98, the rest 0), so the height function still looks alive there. Only per-octave checks catch it. At 1e9 that same fault passes every check, which confirms §4.4's warning.
- **A range test passes a plain-double bug.** At 1e15, `octNaive`'s range is fine, while 87.5% of 1/64 u steps give an equal value. At 1e12 it is clean. That is why `eqStep` exists and why 1e15 is required.
- **The keep-out is tighter than §5.6 reads.** With `h` as the world height of the top, terrain included, room is `abs(x) / 4.8 - height`. On default terrain at p50, that is 27, 29, 26, 18, 4, 29, 13 u at `abs(x)` 150, 200, 300, 400, 515, 700, 1000. So tall towers near the road are capped near 29 u up to about 1032, and §5.7 rule 4's "above 500, tall only" nearly empties the band from 500 to 1032, where terrain alone reaches the limit (p95 / abs(x) .27 against the limit's .208). T01's answer is two bands for tall types: near and scaled down, or beyond 1040 and free. A bare mid-slope is the visible cost. T11 owns `KEEPOUT_K` if it wants more. With no keep-out at all, Neon City's disc occlusion went from 5.8% to 24.3%, so the rule does real work. (closed by DI-06)
- **Sinking by p95 can drown a small object.** See M4. DISH .27 and CASSETTE .22 of quota in Cyber Canyon, before the cap. (closed by DI-06)
- **The first scatter had thin shoulders.** A random band pick gave Boulevard rows with as few as 3 shoulder objects (mean 9). A golden-ratio band pick raised the minimum to 7 with the same mean.
- **`for...of` plus a stats object cost 136 B/call** in the rehearsal scatter, against .3 B/call for plain loops. A simple `for...of` over an array measured 0.01 B/call once the JIT settled, and 168 before. So the test must warm up, and the code should not rely on it. Which part cost what was not isolated.
- **The allocation probe is exact.** One leaked object per call read 32.0 B and a leaked 3-array 72.0 B under Vitest forks. `new Float32Array` read only 551 B per row, since the backing store is outside the JS heap, so this probe undercounts typed-array allocation.
- **Vitest's default reporter hides stdout of a passing test.** `--reporter=verbose` shows it. `--reporter=basic` no longer exists and fails to load.
- **A worst-case metric hid a real defect.** Stepping the biome mix per chunk doubled the mean row step on chunk edges (2.16 times) while the worst step barely moved (12.05 against 12.00), since noise slope dominates the worst case.
- **Thinning is not within 1.** The golden-ratio `keep` strays by more than 1 from `n * d` in 2560 of 42,000 rows, and by more than 2 in none. Mean kept share is exact to three places.
- **Fill was not the limit on cost.** p50 was 15 to 24 us for 37 to 52 records, far below the budget, so retries are affordable.
- **Three rings.** T00's fake, T01's first draft and T05's draft placed RING at y = 0, 95 and 65.14. T05's is the only one derived from the disc, so T01 took it.
- **§5.2's statistics hold with a different gradient table,** within about 10%. p50 at 2000 was 226 against §5.2's 251, the largest gap.

## 11. Decision log

| Decision | Rationale | Date | Author |
|---|---|---|---|
| Top height for keep-out includes terrain, using `y + top * scale` | §5.6's derivation is geometric. Consequence in section 10 | 2026-11-05 | T01 planner |
| Tall archetypes get a near band and a far band from 1040 | §5.6 and §5.7 rule 4 state this (DI-06). Forced by the keep-out finding. 1040 is just outside `C * FOG_END = 1032` | 2026-11-05 | T01 planner |
| `sink = min(p95, .3 * top * scale)`, with deeper roots on DISH, CASSETTE, DOME | §5.7 rule 2 states this (DI-06). Sinking by the p95 alone drowned small objects. The float gate stays. Rehearsed fill .96 or better | 2026-11-05 | T01 planner |
| Mostly-buried rejection at `.7 * top * scale` | At .5, Canyon dishes were rejected too often; at .7 they fill and still show | 2026-11-05 | T01 planner |
| Biome mix is continuous in exact z, memoized per row | §5.2 states this (DI-39). "Pure function of the row's chunk", taken literally, doubles the row step at chunk edges in a fade [O]. A row still evaluates once | 2026-11-05 | T01 planner |
| Stratified counts, slots and golden-ratio band pick; no Poisson | Density is a guarantee, not an expectation. Rehearsed min and mean | 2026-11-05 | T01 planner |
| All look numbers in `biomes.ts` and `palettes.ts`, including `SAG` and `KEEPOUT_K` | §12 gives T11 only those two world files | 2026-11-05 | T01 planner |
| `frozenTable.ts` for scatter goldens, real table for density floors | T11 can retune with no golden edit, while floors still gate the result | 2026-11-05 | T01 planner |
| Hazard rates and item numbers stay in `items.ts` | Not in T11's scope, and T02 balances against them | 2026-11-05 | T01 planner |
| PYLON on a fixed line at x = 100, y = 0, `keep` .1 and .6, `variant` flags a pair in the next row (S-04) | §6.5's catenary needs a known next anchor. T05 draws wires on the flag and reads nothing from the next row, so T01 evaluates row `c + 1` and writes .75 or .25. At 110, Canyon terrain reached 11.5 u and buried half the mast [O]; at 100, p95 is 4.2 u. The two `keep` values survive T05's per-row clamp at d = .4 | 2026-11-05 | T01 planner |
| SEARCHLIGHT only on multiples of 6 | §6.5 says at most 8 on screen with a reach of 47 chunks, and "per chunk 1" alone cannot give that | 2026-11-05 | T01 planner |
| RING `y = 65.14`, `zLocal = 32`, `keep = 0` | T05's draft derives 65.14 so the ring lies on the disc outline at 465 u, and ignores the record's y. T01's first value, 95, had no such property, so T01 writes T05's, keeping the record true. T05 now draws from the record (S-03) | 2026-11-05 | T01 planner |
| TRAFFIC travel at most 128 u, sim window `p - 2 .. p + 1` | §5.8 says 4 chunks and §7.1 says current and next. Moving cars need the two behind, and this makes four sufficient. (superseded by S-11: `c - 2 .. c + 1`, `c = travel.chunk`) | 2026-11-05 | T01 planner |
| Checkpoint arch is a GATE with `a = 1` at `c % 100 === 0`, replacing a normal gate when they coincide | §7.1 needs a visible arch, no `ItemKind` exists, and it reuses T05's mesh. T02's draft reconciled to this exact rule. A row holds one arch, per §6.5's cap | 2026-11-05 | T01 planner |
| Hazards keep clear of the lane, by construction | Autopilot must thread 80% (§11.2), and a new player should always have a line | 2026-11-05 | T01 planner |
| Disc occlusion gate at 10% in T01, not §11.5's 15% | Measured 4.0 to 7.6%, and the negative control at 15% was only reached by Neon City and Boulevard. T11's real metric keeps 15% | 2026-11-05 | T01 planner |
| Vitest env-var modes rather than new scripts or `.bench` files | T00 owns `package.json` and its include pattern is `*.test.ts`. A timed gate must not run in `check:task` under sibling load | 2026-11-05 | T01 planner |
| CPU impostor preview, no `dev/` page | §12 grants none, and Agents.md's look-at-it rule still applies. Stated as a limit, not as a GPU screenshot | 2026-11-05 | T01 planner |
| Negative chunks valid | T03 and T05 can address rows behind the camera at chunk 0. Arithmetic in §4.4 already handles them [O for height] | 2026-11-05 | T01 planner |
| Palette crossfade is per-slot OKLCh, not straight OKLab | DI-05: a quarter of travel time is a crossfade, and a straight mix turns beige for several seconds. Grid and accent saturation worst .41 against .18 [arithmetic]. T01 has not written it yet, and T11 keeps `palettes.ts` to retune it | 2026-11-05 | T00 owner |
| Doubles cross between hot helpers only through `Float64Array` registers: `createHeight` returns `{ at, regs, run }`, `createScatter` takes a `HeightCore`, and `surfaceInto`, `sinkInto`, `coarseInto`, `gateRejects`, `fitKeepOutAt` read registers. `spacingAt`, `coarseSurface`, `fitKeepOut` and friends stay as argument forms over the same code, for tests | The under 4 B gate failed at 232 B/call as written, and any fix relying on inlining flips with code size (section 10). A Deviation under Agents.md: signatures internal to `src/world`, no contract touched | 2026-11-05 | T01 executor |
| `src/world/draws.ts`, `hash01`'s text inlined with a shared prefix, held equal to `hash01` by `toBe` in `draws.test.ts` over seeds, chunks including negative and past 2^32, salts and bases | `hash01` returns a double, and it stopped being inlined inside a row. T00 owns `hash.ts`, so the copy is here and a test ties them | 2026-11-05 | T01 executor |
| `ridged` in `noise.ts` is `oct`, `gradP` and `hsh` inlined, with the z half cached per row. `oct` stays §4.4's text, for the per-octave tests and drills | M7's condition: lower in Chromium (16.10 against 32.47 B/sample at level 0) and byte-identical by the goldens and `ridged, the inlined octave loop` | 2026-11-05 | T01 executor |
| The starting side of a row is a golden-ratio walk per archetype, not `hash01(seed,c,a,1)` | Plan's own pseudocode failed plan's own A7 (6% over 2000 rows) and A8 (`columnMin=0`). Small course change. Within a row, sides still alternate | 2026-11-05 | T01 executor |
| The left and right rule counts SEARCHLIGHT over 12,000 rows | It stands on every 6th chunk, so 2000 rows hold 333 records and 5% is inside one sigma. Same threshold, more samples. The rule also runs from zone `floor(1e15 / 6400)` | 2026-11-05 | T01 executor |
| DRONE clear distance is radius + 4.5, and it goes on the inner side when the outer side has no room for its swing | The plan's clamp broke its own clearance, and radius + 3 did not cover 2.5 u of path stray plus a 2 u ship (section 10). Section 4's "at least `a + radius + 3`" stays true | 2026-11-05 | T01 executor |
| A checkpoint chunk counts as a gate chunk for SPIKE and FENCE, and FENCE keeps 32 u before a checkpoint too | The plan names gates. An arch at `c % 100 === 0` stands off the 3-chunk grid, and A9's "no fence within 32 u before a gate" should not depend on which kind | 2026-11-05 | T01 executor |
| `d` clamps at 0 as well as at zone 12, for hazards and `objectiveTarget`, and `musicKey` uses a floored mod | Negative chunks are valid input, and the table's `min(index, 12)` alone gives a target below the first zone's | 2026-11-05 | T01 executor |
| Hazard rise and flatness compare blocks of six zones | A single zone's biome swings traffic by a factor of 3 on the Boulevard, which would swamp difficulty. Each block holds each biome once. A9's numbers unchanged | 2026-11-05 | T01 executor |
| The allocation probe sums rising sub-windows of 5000 calls, and the gate rewarms up to 4 times before failing | A scavenge inside one before-and-after window hides everything before it. The JIT tiers up on background threads, so under load a first reading can come from unoptimized code. A boxed double or a leak reads the same however long it warms: D10 still read 600 B/call. Far chunks go through a tagged array, so the probe does not box its own argument | 2026-11-05 | T01 executor |
| Imported bindings are hoisted to module-level consts in the per-sample modules | Getters under Vitest cost 3 to 5 times (section 10). No effect on output: all 12 previews byte-identical by md5, goldens unchanged | 2026-11-05 | T01 executor |
| Boulevard ARCOLOGY quota 3, OBELISK 2. The frozen table keeps the first values | M8: upper slope read bare. Floors and goldens unaffected, occlusion unchanged at 8.0% worst | 2026-11-05 | T01 executor |
| `perf.test.ts` runs its allocation gate always, about 4 s | Section 4's seam says under 3 s, while A11 requires this gate without an env var. A11 is the acceptance row, and the whole file set ran in 6.7 s under `check:task` | 2026-11-05 | T01 executor |
| Ruling: `draws.ts`, `hash01`'s arithmetic inlined with a shared prefix, **accepted** | `draws.test.ts` holds it equal to `hash01` by `toBe` over negative seeds, seeds above 2^32, chunks above 2^32 and up to 2^53 - 1, and fails on E3 and E21. T00 owns `hash.ts`, so the copy lives here | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: internal signatures (`createHeight` returns `{ at, regs, run }`, `createScatter` takes a `HeightCore`, the register forms) **accepted** | `WorldSource` and `CreateWorld` unchanged, `purity.test` asserts the contract factory, no sibling imports world internals, E1, E2, E19 and E32 to E34 are caught | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: golden-ratio starting side per archetype **accepted** | The plan's hash failed the plan's own A7 (6%) and A8 (`columnMin=0`) at an unchanged threshold. The test gap it exposed is repaired by `sides alternate candidate by candidate inside every row` (D14) | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: DRONE clearance radius + 4.5 with the inner-side flip **accepted** | E5 (radius + 3) gave 13 solvable-road hits, E6b failed two A9 rows, E6 failed the schema. Section 4's `a + radius + 3` still holds | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: checkpoint chunks count as gate chunks for SPIKE and FENCE **accepted** | Stricter than the plan, and A9's fence rule no longer depends on gate kind; E27 shows the tests read both kinds | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: hazard rise and flatness over blocks of six zones **accepted** | One zone's biome swings traffic 3 times. Note from V1: the `zone40` block is zones 36 to 41, since its start is `floor(40 / 6) * 6` | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: allocation probe sub-windows and up to 4 `settled()` attempts **accepted with a condition**, now met | Condition: `settled()` prints every attempt's reading. It now prints one `ALLOC attempts <name> limit=<> readings=<r1,r2,..> pass|FAIL` line per probe; D10 shows four readings on a failing probe, and `fillItems` shows a pass after one retry on every run (section 10) | 2026-11-05 | V1 verifier, reviewer; T01 executor, repair R1 |
| Ruling: Boulevard ARCOLOGY 3 and OBELISK 2 **accepted** | A `biomes.ts` look tune in M8. E29, the plan's values, passes every test, so floors and goldens do not lean on it | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: always-on `perf.test.ts`, about 4 s **accepted** | A11 needs the gate in `check:task`; the set ran in 5.79 to 6.45 s under `check:task`, and per-test timeouts are 300 s | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: floored `d` clamp and mods for negative chunks **accepted** | Negative chunks are valid by §8.1; E7 and E45 fail `negative chunks are valid and in range` | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: inlined `ridged` with a per-row z cache, and hoisted imports, **accepted** | V1 reproduced the Chromium numbers (32.47 and 154.29 B/sample as written, 16.10 and 23.73 inlined); byte-identical to `oct` by test, E1 and E2 caught, previews byte-identical | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Ruling: the left/right rule counts SEARCHLIGHT over 12,000 rows and also runs from zone `floor(1e15 / 6400)` **accepted** | Same threshold, more samples; at 2000 rows a 5% rule on about 333 records is one sigma | 2026-11-05 | V1 verifier, reviewer; recorded by T01 executor |
| Node `height` ceiling tightened from 64 to 8 B per sample, with 40-row sub-windows and a height-probe leak control | V1's fix: "tighten the Node ceiling, for example to 8 B/sample", with this entry. A tightening, not a loosening. The sub-window change is this repair's own: without it no ceiling sees a per-sample leak (0.86 B/sample with one, section 10). The reading is now 0.04 against 8, the leak 27.23. T09 keeps the Chromium gate (DI-16) | 2026-11-05 | T01 executor, repair R1; tightening agreed by V1 verifier; sub-window change accepted by V2 verifier (section 14) |
| `keep-out holds` and the two K-dependent `fitKeepOut` cases derive the limit from `KEEPOUT_K / KEEPOUT_C` | V1's fix, first option. The T11 seam promises a green suite after a retune, and D18 (K .06) now passes all 133 tests while D15 (10% lenient) and D8 still fail | 2026-11-05 | T01 executor, repair R1; agreed by V1 verifier |
| `no mostly buried object` gates scattered grounded records at `abs(x) > 85`, and prints PYLON instead of gating it | V1's fix text named every grounded record. PYLON is a fixed line at y = 0 for T05's wire (section 4, S-04) that M4's steps never govern, and it failed the check in Canyon only (163 of 4000). Gating it would test a rule the code does not apply to it; dropping it silently would hide a real look question. DI-69 decided that question: accepted for now, and T11 judges the Canyon lines on the real build. No threshold of an existing test moved | 2026-11-05 | T01 executor, repair R1; narrower than V1's fix text by PYLON; decided by the T00 owner in DI-69, accepted by V2 verifier (section 14) |
| `the row cache cannot change a result` steps one key field at a time: `(iz, 2, .5)`, then `(iz, 2, 1.5)`, `(iz, 4, 1.5)`, `(iz + 1, 4, 1.5)`. Drill D17 now covers each key field, one run each | V2's finding: the old "zs neighbour" `(iz, 4, .5)` followed `(iz, 2, 1.5)`, two fields apart, so a key without `zs` passed (VzsKey: 22 of 22). A tightening: same file, same `toBe` asserts, no threshold | 2026-11-05 | T01 executor, repair R2; fix as V2 proposed |
| `sides alternate` checks slot parity as well as V1's count rule | V1 asked for left and right within 1 plus the rejected count. The parity form also catches a row alternating in pairs, which the count rule passes. Both are asserted | 2026-11-05 | T01 executor, repair R1 |
| **DI-118: the lane has a height, alternating bands, gate radius 8** | The operator asked for a swooping path. A pure function of the node keeps O(1) at any chunk; alternating bands make every gate climb or dive, where uniform draws gave a 1.7 u mean step. 8 is kept as the floor so the solvable road's traffic clearance, by height alone, holds | 2026-11-07 | T00 owner, for the operator |
| **DI-118: `ITEM_GOLDEN` re-recorded** as `[3510218, 2261875425]` (was `[928456839, 2782424726]`; `[2115507778, 3397986301]` at radius 6 and `[1812437225, 2986990596]` at radius 8 a unit higher, both superseded the same evening) | Gates and shards moved to the lane's height and the gate radius changed, so every row with a gate or shard changed. Same engine (Node 24.14.1, V8) | 2026-11-07 | T00 owner, for the operator |

## 12. Contract change requests

All decided in `plans/RECONCILIATION.md`. The text below is a record: §8 carries the outcome, and §8's wording wins. No fallback applies.

**CCR-T01-1. Archetype and item facts: CCR-T05-1, with T01's numbers.** State: amended, C-07; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. The table is in §8.1, with fields `top`, `root`, `perChunk`, no `radiusU`, and RING at `top: 100, root: 0`. As filed: T01 needs a mesh's height and root to apply §5.6 and §5.7, and T05 needs the same numbers to build it. §6.5 gives neither, and neither task may import the other. T05 raised the same table first. T01 supports **CCR-T05-1's diff as written**, including its field names (`maxDist`, `perChunkMax`, `heightU`, `rootU`, `radiusU`, `floats`), `ITEM_KIND_COUNT` and `ITEM_SPEC`. T05 asked that T01's numbers win where T01 settled others, and these five rows differ:

```ts
  { maxDist: 4000, perChunkMax: 2,  heightU: 40,  rootU: 20,  radiusU: 40,  floats: false }, // PYRAMID, rootU was 14: §5.7 rule 4 needs 20 above abs(x) 500
  { maxDist: 3000, perChunkMax: 2,  heightU: 20,  rootU: 3,   radiusU: 7,   floats: false }, // PYLON, heightU was 22: the line moved from 110 to 100
  { maxDist: 3000, perChunkMax: 1,  heightU: 6,   rootU: 6,   radiusU: 2,   floats: false }, // SEARCHLIGHT, was 3 / 1: Canyon fill was .07 of a quota of .17 at 3 / 1
  { maxDist: 1200, perChunkMax: 6,  heightU: 9,   rootU: 1.5, radiusU: 2.5, floats: false }, // TOTEM, rootU was 1
  { maxDist: 1200, perChunkMax: 8,  heightU: 8,   rootU: 1.5, radiusU: 3,   floats: false }, // CACTUS, rootU was 1
```

T05's RING row (168 / 38) stands, since T01 exempts RING from every rule that reads those fields. T01's test asserts the sum of `perChunkMax` stays under `MAX_PROPS_PER_CHUNK`. Fallback if rejected: T01 keeps the table in `biomes.ts`, T05 keeps its own, and they can drift with no check, which the two plans' tables must then be compared to prevent.

**CCR-T01-2. Item motion limits and record meaning.** State: amended, C-08 and C-01; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. `ITEM_WINDOW_BEHIND`'s comment uses `c = travel.chunk` (S-11). As filed: T02 and T05 must use the same fade and T02 must read the right chunks. T02's draft supports this request as written. CCR-T05-2 proposes the first two constants with the same names and values, with a different comment, so only one of each should land. `src/contracts/index.ts`, after `ITEM_STRIDE`:

```ts
/** TRAFFIC's a is at most this, so zLocal + a < 3 * CHUNK_LEN and a car stays within its home chunk + 2. */
export const TRAFFIC_TRAVEL_MAX = 128;
/** With f = fract(b * phase7 + seed), TRAFFIC scale = min(1, f / TRAFFIC_FADE, (1 - f) / TRAFFIC_FADE). It collides only while that is 1. */
export const TRAFFIC_FADE = 0.1;
/** Collision reads item rows of home chunks p - ITEM_WINDOW_BEHIND .. p + 1, where p is the ship's chunk. */
export const ITEM_WINDOW_BEHIND = 2;
```

And in T00's open CCR-1, replace the `ItemField` comment with this, which differs only for GATE and FENCE:

```ts
/** Offsets in one ITEM_STRIDE record. SHARD, SPIKE: a = b = 0. GATE: a = 1 for a sector checkpoint arch, otherwise 0; b = 0. FENCE: x span centre, radius span half-width, a gap centre x, b gap half-width; hits at any y. DRONE: a amp, b integer k, phase 3. TRAFFIC: a travel, b integer k, phase 7. seed in [0, 1). */
```

Fallback: the seam table's numbers, restated by T02 and T05 in their own constants.

**CCR-T01-3. Biome and palette names.** State: approved, C-10; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. As filed: T04 must key aurora and lightning on a biome (§5.4), T09 and T10 pass indices to `forceZone`, and T11's sheet labels them. A bare index means each task re-derives the order. `src/contracts/index.ts`, after `BIOME_COUNT`:

```ts
export const Biome = { BOULEVARD: 0, NEON_CITY: 1, CRYSTAL_DESERT: 2, CYBER_CANYON: 3, ORBITAL_NIGHT: 4, OLYMPUS: 5 } as const;
export const PaletteId = { SUNSET_DRIVE: 0, MIAMI_DUSK: 1, ULTRAVIOLET: 2, TOXIC_ARCADE: 3, EMBER: 4, ARCTIC_LASER: 5 } as const;
```

Same order as T08's `BIOME_NAMES` and `PALETTE_NAMES` (CCR-T08-4), which are display strings and do not replace these. The fake world uses the same numbers, since T00's `biomeA = index % 6` covers all six. Fallback: §5.4 and §6.8 table order, by seam.

**CCR-T01-4. Comments on existing types.** State: amended, C-12; absorbed into architecture.md §8 on 2026-11-05; §8's wording wins. As filed: comments only, no type change, so `contracts:check` counts them as added lines. `ZoneState`, before `objective`:

```ts
  // objectiveTarget: GATES count, CHAIN consecutive shards, GRAZES count, NO_HIT u, BOOST u. objectiveProgress uses the same unit.
  // biomeB, paletteB, heroB always hold the next zone's value; ignore them at mix 0. dayPhase is a sawtooth in [0, 1). musicKey is a semitone offset in [0, 12).
```

`WorldSource`, before `fillProps`:

```ts
  /** Chunk may be any integer below 2^48, negative included. out.chunk is set to chunk as passed. Row contents never depend on out's prior contents. */
```

Fallback: the section 4 tables.

**The build filed no new request.** Everything it needed was in §8.

**T01 does not need** T00's CCR-2 (`createPropRow` and so on): its tests use `support/rows.ts` (C-02), and production code allocates no row. `scatter.ts` and `items.ts` use `PropField` and `ItemField` (C-01).

## 13. Outcomes and retrospective

**Result against Purpose.** All six hold on this project's code, on Node 24.14.1 and the Ryzen 3900X.

1. Never flat, never repeating. Per-octave range, zero fraction, bounds and fine step hold at 1e9, 1e12, 1e15 and 1.8e16, and D1, D2 and D3 each fail the test written for them.
2. Full in every biome. Worst live count 807 against a floor of 700. Fades 821. Every one of 16 columns holds an object at every one of 200 positions in every biome, with the worst column at 1. Identity worst .586 against .65. Ring capacity holds by the schema test on `perChunk`.
3. Sun framed. Worst disc occlusion 8.3% outside Canyon, against 10%. Keep-out off reads 30.4%.
4. Grounded. `no floating object` is 0 over 2000 rows per biome, with D9 reading 398 when the rejection goes.
5. Same bytes. Every row of the purity table passes, including `k + 1024 * 2^37`.
6. Cheap. `fillProps` p50 8.9 to 14.7 us, p99 at most 25.3 us. Allocation at most 2.01 B/call, also at 1e15. Refill p95 16.44 ms. All under sibling load, so not the quiet machine A12 names, and within budget anyway.

**Gaps.** A16 has not run, by the batch's order. A12's machine was not quiet: the numbers are upper bounds on load, and a load reading of 33 to 56% is a sample, not a measure of the run. The upper slope stays the emptiest part of every non-Canyon picture, which is the keep-out's cost, and T11 owns `KEEPOUT_K`.

**Lessons.** Write hot JavaScript so no double crosses a call, instead of counting on the inliner. A test that runs with only one instance of a closure factory measures a different program. Under Vitest, an imported binding in a per-sample path is a measurable cost. Name the failing site with the sampling profiler, then bisect: reasoning about what V8 would do was wrong more than once here.

**Not verified, and not verifiable by T01.** How any of this looks on a GPU with real meshes and post. The impostor's outlines are wider than T05's meshes will be, so density reads higher here [I]. Whether density feels right in motion. Whether the keep-out survives T11's real disc-occlusion metric. Whether the gate's triangle shape matches T03's final mesh. Any performance on a phone. Node on one Ryzen 3900X establishes nothing about a browser, except the Chromium allocation numbers in section 10, which are one build on one desktop.

**Human checks.** None listed. Section 7 has none, and a person's judgement of the look belongs to T05 and T11.

**Repair R1.** V1 passed T01 with no blocking defect and five low ones for T01. All five are fixed in test files only, and each fix fails on its mutation and passes after restore (Progress). The mostly-buried rule and in-row side alternation now have behaviour tests (D13, D14). `keep-out holds` follows a T11 retune of `KEEPOUT_K` (D18 passes, D15 fails). The height allocation gate sees a leak (D16 reads 27.23 against 8), which took a probe fix as well as the tighter ceiling. The row-cache test asserts every neighbour (D17). V1's one condition is met: `settled()` prints every attempt. All 11 rulings are in section 11 with V1 as reviewer. No `src/world` file changed, so goldens, density, occlusion and previews are as before. Applied T00-owner decisions: DI-64, A16 is held by the T00 owner, and T01 counts as done for T10 only after the post-repair whole-repo run is green. DI-66, Ultraviolet's pale disc and the pastel fade midpoints are on T11's list; no T01 code change. DI-66 also asks T10 to check the demo ship's fence clip on this real world, where `solvable road` holds for a straight lane path at y = 8 and radius 2 and says nothing about the title fixture's ship.

**Not verified in R1.** A16 (the T00 owner's run). A12 on a quiet machine, not rerun. Whether Canyon pylons buried at their far reach are visible or matter on the real build: DI-69 accepts the PYLON scope of `no mostly buried object` for now and leaves that judgement to T11 on the real build. The sub-window change had no reviewer in R1; V2 accepted it, and the PYLON scope under DI-69 (section 14). Why `fillItems`' first allocation reading is high.

**Repair R2.** V2 passed T01 with no blocking defect and two low ones, both fixed. `the row cache cannot change a result` now steps one key field at a time, so a row key that drops `iz`, `zs` or `zLocal` each fails its own labelled line (VzsKey, which passed 22 of 22 before, now fails `zs neighbour at 0`). Sections 10, 11 and 13 cite DI-69 instead of framing the PYLON scope as open. No `src/world` file changed, so goldens, density, occlusion and previews are as before. **Not verified in R2:** the same as R1, less the two reviewer agreements V2 supplied.

## 14. Revision notes

- 2026-11-05T06:32Z Initial draft, compared by hand with the T02, T05, T06 and T08 drafts. No approved revisions.
- 2026-11-05 Reconciled per plans/RECONCILIATION.md: C-01, C-02, C-07, C-08, C-10, C-11, C-12, S-03, S-04, S-05, S-06, S-07, S-10, S-11, S-13, DI-05, DI-06, DI-16, DI-39.
- 2026-11-05T08:55Z Seam row reworded per DI-41. T01's algorithm, values and tests are unchanged.
- 2026-11-05T10:15Z Applied the section 4 `keep` wording from DI-41 from the full-text reviews, decided by the T00 owner in plans/RECONCILIATION.md.
- 2026-11-05T15:45Z Executor, during the build, all in section 11's rows. Section 3: added `draws.ts`, `draws.test.ts`, `support/alloc.ts`, `support/worlds.ts`. M3 and M5: `createHeight` and `createScatter` signatures. M5: the side rule. M6: the DRONE rule. D8's wording, because the keep-out's working form is now `fitKeepOutAt`. No threshold or expected value was loosened.
- 2026-11-05T19:45Z Independent verifier V1-T01, review only, no code changed. Verdict: passed, no blocking defect. `check:task T01` exit 0 twice, `plans:check` exit 0, all 131 tests green with 2 env-gated skips, the BENCH run within budget under sibling load, the 12 previews re-rendered byte-identical and viewed, the Chromium height numbers of section 10 reproduced, D1 to D12 each failing their named tests, plus 41 verifier mutations, all restored by hash. Low findings, recorded for T01: the mostly-buried rejection and the in-row side alternation are guarded only by the frozen-table digest; `keepout.test.ts` hard-codes 4.8, so a sanctioned T11 retune of `KEEPOUT_K` turns it red; the 64 B/sample height ceiling passes one leaked object per call; the row-cache test never asserts its zLocal-neighbour case. Rulings, as the reviewer Agents.md names: `draws.ts` accepted, since `draws.test.ts` fails on both verifier mutations of it. Internal signatures accepted, since `WorldSource` is unchanged and no sibling imports world internals. Golden-ratio starting side accepted, since the plan's hash failed the plan's own A7 and A8 at an unchanged threshold. DRONE radius + 4.5 with the inner flip accepted, since radius + 3 gave 13 solvable-road hits and the plan's clamp failed both A9 rows. Checkpoints as gate chunks accepted, since that is stricter and the tests read both kinds. Hazard blocks of six zones accepted, since one zone's biome swings traffic 3 times; note that the "zone40" block is zones 36 to 41. Allocation probe sub-windows and rewarm accepted on one condition: print every attempt's reading, so a pass after a retry is visible. Boulevard ARCOLOGY 3 and OBELISK 2 accepted, since reverting them passes every test. The 4 s always-on `perf.test.ts` accepted, since A11 needs the gate in `check:task` and the full set ran in under 7 s.
- 2026-11-05T20:15Z Repair R1 by the T01 executor, after V1's verdict. Status went to in-progress at 20:01Z and back to done. Test files only: `grounding.test.ts`, `scatter.test.ts`, `keepout.test.ts`, `noise.test.ts`, `perf.test.ts`, `support/alloc.ts`. Plan: section 4 PYLON note (the Canyon burial figure); M7 and A11 (8 B/sample height ceiling, 40-row sub-windows, the height leak control, printed attempts); A5 (limit from `KEEPOUT_K / KEEPOUT_C`); A6 and A6n (`no mostly buried object` and its control); A7 (`sides alternate`); A14 and the drill table (D13 to D18); Progress, section 10, section 11 (the 11 V1 rulings with V1 named as reviewer, and 4 repair decisions), section 13; DI-64 and DI-66 applied. One threshold moved, tighter: the height ceiling, 64 to 8 B/sample, which V1 proposed. One new test is narrower than V1's fix text, by PYLON, and is marked as not yet agreed.
- 2026-11-05T21:20Z Second independent verifier V2-T01, review only, no code changed (`updated` left as is, per the one-note rule). Verdict: passed, no blocking defect. Every R1 claim was confirmed: all 12 `src/world` md5s equal V1's start hashes, and only the six named test files changed. `check:task T01` exit 0 twice (133 passed, 2 skipped), `plans:check` and `contracts:check` exit 0, the verbose run matches R1's printed lines and goldens, the BENCH run through gpu-lock is within every budget (contaminated, CPU 53 to 65% with 38 node processes), and the 12 previews re-render byte-identical and were viewed. D1 to D17 each fail their named tests across all 13 files and D18 passes, plus 6 verifier mutations, all restored by md5. Rulings, as reviewer: the height probe's 40-row sub-window is **accepted**, because putting 5000 back makes its own leak control read 1.12 B/sample, so the old probe was blind. The typed-array accumulator is **accepted**, because the old closure `let` with 40-row windows reads 14.91 B/sample of the probe's own boxing, which separates R1's two causes. The PYLON exclusion from `no mostly buried object` is **accepted under DI-69**: it is narrow (only `a !== Archetype.PYLON`, and `checked` also leaves PYLON out), the per-biome pylon count is printed, and every other archetype stays gated (D13 1086, and a bury limit of .95 gives 647). The parity form of `sides alternate` is **accepted** as a tightening, because a pairwise-alternating mutant fails it (143,884 problems). The two new negative controls (bury control over 100, height leak over 16 B/sample) are **accepted**, reading 3625 and 27.23. Two low findings for T01: a ridged row key that ignores `zs` passes `the row cache cannot change a result`, because its "zs neighbour" call `(iz, 4, .5)` follows `(iz, 2, 1.5)` and so differs in two fields, against its comment (only `height the memo cannot change a result` catches it); and sections 10, 11 and 13 still frame the PYLON scope as open to the T00 owner, while DI-69 has decided it. Not re-run: A16 (the T00 owner's, DI-64) and the Chromium height probe (code unchanged since V1 reproduced it).
- 2026-11-05T21:56Z Repair R2 by the T01 executor, after V2's verdict. Status went to in-progress at 21:53Z and back to done. Test file: `noise.test.ts` only, the row-cache test's neighbour calls and its name. Plan: drill D17 widened to the `zs` and `iz` keys; sections 10, 11 and 13 cite DI-69 for the PYLON scope; section 11 records V2's acceptance of the R1 sub-window change and adds one R2 row; section 13 gains an R2 paragraph; Progress. No threshold or expected value moved.
- 2026-11-07T21:30Z Reopened by the T00 owner for T11's operator review (DI-118), status `in-progress`: the lane's height, gates at it with radius 6, shards following, the solvable road flown in height, the golden re-recorded, an allocation found and fixed; close to follow.
- 2026-11-07T23:35Z DI-118 closed, status `done`.
- 2026-11-12T18:04Z **Identifiers replaced (T12, DI-120), at the operator's choice before the repository is made public.** The operator's Windows user name in session scratch paths now reads `<user>` (2 lines). Nothing else in those lines changed, quoted text included. The commits before this one keep the old text. Status unchanged. Not committed.
