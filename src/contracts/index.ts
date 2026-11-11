// src/contracts/index.ts
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

// ---- scale and lattice (1 u = 1 m) ----
export const CHUNK_LEN = 64;
export const WORLD_PERIOD = 4096;      // every shader-visible world pattern has a period dividing this
export const CHUNK_LIMIT = 2 ** 48 - 1024;   // warp refuses chunk >= this; the headroom keeps rows ahead of the camera below 2^53
export const ROW_MOD = 65536;          // instance rows are chunk mod ROW_MOD

export const CLIP_LEVELS = 6;
export const CLIP_BASE_SPACING = 2;
export const CLIP_COLS = 128;
export const CLIP_ROWS = 96;
export const CLIP_RING_ROWS = 128;
export const CLIP_HOLE_COLS = 30;
export const CLIP_HOLE_ROWS = 45;
export const CLIP_REAR_ROWS = [16, 8, 4, 2, 2, 2] as const;
export const CLIP_DROP = [0, 0.02, 0.06, 0.2, 0.7, 2.4] as const;

export const FOG_START = 1500;
export const FOG_END = 4300;
export const CAMERA_FOV = 58;
export const CAMERA_FOV_MAX = 68;
export const CAMERA_HALF_TAN_MAX = 1.574;   // horizontal, the 21:9 value at CAMERA_FOV_MAX (§6.4)
export const CAMERA_Y = 7;
export const CAMERA_PITCH = 0.05;
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 6200;

export const VALLEY_HALF = 85;
export const ROAD_HALF = 22;
export const PLAY_HALF_X = 40;
export const PLAY_Y_MIN = 2;
export const PLAY_Y_MAX = 14;
/** The ship is drawn this far ahead of the camera plane, and collision sweeps travel + SHIP_FORWARD. Its collision radius is 1.6 u (T02's SHIP_HIT_RADIUS; T01's solvable road assumes at most 2 u), and T05 draws it 3.2 u wide. */
export const SHIP_FORWARD = 14;

export const ZONE_CHUNKS = 100;
export const ZONE_FADE_CHUNKS = 25;
export const PALETTE_COUNT = 6;
export const BIOME_COUNT = 6;
/** Index order is the rows of §5.4 and §6.8. zone.biomeA and zone.paletteA index these, and T01's tables follow the same order. */
export const Biome = { BOULEVARD: 0, NEON_CITY: 1, CRYSTAL_DESERT: 2, CYBER_CANYON: 3, ORBITAL_NIGHT: 4, OLYMPUS: 5 } as const;
export const PaletteId = { SUNSET_DRIVE: 0, MIAMI_DUSK: 1, ULTRAVIOLET: 2, TOXIC_ARCADE: 3, EMBER: 4, ARCTIC_LASER: 5 } as const;
/** Display names, in the same order. They do not replace Biome and PaletteId. */
export const PALETTE_NAMES = ['Sunset Drive', 'Miami Dusk', 'Ultraviolet', 'Toxic Arcade', 'Ember', 'Arctic Laser'] as const;
export const BIOME_NAMES = ['Boulevard', 'Neon City', 'Crystal Desert', 'Cyber Canyon', 'Orbital Night', 'Olympus'] as const;
export const DAY_CHUNKS = 750;

export const SIM_HZ = 120;
export const BPM = 100;
export const SPEED_FLOOR = 45;
export const SPEED_CRUISE = 80;
export const SPEED_MAX = 150;

export const PHASE_COUNT = 8;
/** Beat, bar, phrase, then 1 s, 4 s, 16 s, 64 s, 256 s. Integer ticks, so phases are exact. */
export const PHASE_PERIOD_TICKS = [72, 288, 1152, 120, 480, 1920, 7680, 30720] as const;

export const PALETTE_FLOATS = 21;      // 7 linear RGB: top, mid, horizon, discTop, discBottom, grid, accent
export const PROP_STRIDE = 8;          // x, y, zLocal, yaw, scale, keep, tintSeed, variant
export const ITEM_STRIDE = 8;          // kind, x, y, zLocal, radius, a, b, seed
/**
 * Offsets in one PROP_STRIDE record. x lateral u. y world y of the mesh origin: grounded, true height minus sink, exactly 0 at abs(x) <= VALLEY_HALF; floating, true height plus hover, the object's centre.
 * zLocal in [0, CHUNK_LEN). yaw radians about +y: local +z maps to (sin yaw, 0, cos yaw), so a mesh's front faces +z and yaw 0 faces the approaching camera. scale > 0, uniform.
 * keep, tintSeed, variant in [0, 1). An instance is drawn while its ring keep, which is keep or higher (§6.5), is < density. A consumer computes floor(variant * n). PYLON: floor(variant * 2) === 1 means the next row also holds a pylon pair, so the wires are drawn. SEARCHLIGHT: yaw is a sweep phase offset.
 */
export const PropField = { X: 0, Y: 1, Z_LOCAL: 2, YAW: 3, SCALE: 4, KEEP: 5, TINT_SEED: 6, VARIANT: 7 } as const;
/**
 * Offsets in one ITEM_STRIDE record. x, y absolute u, the centre. radius > 0 is the pickup, opening or hit radius; meshes scale by it, except SHARD, which draws at a fixed size. seed in [0, 1).
 * SHARD, SPIKE: a = b = 0. GATE: a = 1 for a sector checkpoint arch, otherwise 0; b = 0; threaded when the ship's centre is within radius. FENCE: x span centre, radius span half-width, a gap centre x, b gap half-width; hits at any y, and y is for drawing.
 * DRONE: a amp, b integer k, phase 3. TRAFFIC: a travel, b integer k, phase 7. Records ascend by kind, then zLocal, so (chunk as passed, record ordinal) is a stable identity.
 */
export const ItemField = { KIND: 0, X: 1, Y: 2, Z_LOCAL: 3, RADIUS: 4, A: 5, B: 6, SEED: 7 } as const;
/** TRAFFIC's a is at most this, so zLocal + a < 3 * CHUNK_LEN and a car stays within its home chunk + 2. */
export const TRAFFIC_TRAVEL_MAX = 128;
/** With f = fract(b * phase7 + seed), TRAFFIC scale = min(1, f / TRAFFIC_FADE, (1 - f) / TRAFFIC_FADE). It collides only while that is 1. */
export const TRAFFIC_FADE = 0.1;
/** Collision reads item rows of home chunks c - ITEM_WINDOW_BEHIND .. c + 1, where c = travel.chunk. That sees every crossing of the ship plane, travel + SHIP_FORWARD. */
export const ITEM_WINDOW_BEHIND = 2;
export const MAX_PROPS_PER_CHUNK = 128;
export const MAX_ITEMS_PER_CHUNK = 32;
export const EVENT_CAPACITY = 64;
export const SHIELD_MAX = 3;           // SimState.shields is an integer in [0, SHIELD_MAX]
export const SYNC_MAX = 16;            // SimState.sync is an integer in [1, SYNC_MAX]

export const Archetype = {
  PALM: 0, ARCOLOGY: 1, PYRAMID: 2, ORB: 3, COLONNADE: 4, BILLBOARD: 5, PYLON: 6, REFLECTOR: 7,
  CRYSTAL: 8, SAUCER: 9, SEARCHLIGHT: 10, TOTEM: 11, DISH: 12, RING: 13, OBELISK: 14, DOME: 15,
  TURBINE: 16, CASSETTE: 17, CACTUS: 18, CHEVRON: 19,
} as const;
export type Archetype = (typeof Archetype)[keyof typeof Archetype];
export const ARCHETYPE_COUNT = 20;
/**
 * Facts T01 places by and T05 builds to, in u at scale 1. top: mesh reach above its origin, the half-height if it floats. root: buried depth below the origin, 0 if it floats.
 * Origin: ground contact, or the centre if it floats. maxDist: draw reach. perChunk: T01 never emits more of it in one row.
 * RING appears only on chunk % 48 === 0, and T01's keep-out and sag rules ignore it. SEARCHLIGHT's top and root describe a housing T05 does not draw. T11 does not retune this table.
 */
export interface ArchetypeSpec { readonly maxDist: number; readonly perChunk: number; readonly top: number; readonly root: number; readonly floats: boolean }
export const ARCHETYPE_SPEC = [
  { maxDist: 1600, perChunk: 10, top: 14,  root: 1.5, floats: false },   // PALM
  { maxDist: 4000, perChunk: 6,  top: 50,  root: 20,  floats: false },   // ARCOLOGY
  { maxDist: 4000, perChunk: 2,  top: 40,  root: 20,  floats: false },   // PYRAMID
  { maxDist: 1200, perChunk: 3,  top: 3.5, root: 0,   floats: true },    // ORB
  { maxDist: 1600, perChunk: 6,  top: 12,  root: 1.5, floats: false },   // COLONNADE
  { maxDist: 1600, perChunk: 3,  top: 12,  root: 4,   floats: false },   // BILLBOARD
  { maxDist: 3000, perChunk: 2,  top: 20,  root: 3,   floats: false },   // PYLON
  { maxDist: 800,  perChunk: 32, top: 1,   root: 0.3, floats: false },   // REFLECTOR
  { maxDist: 2000, perChunk: 8,  top: 3.5, root: 0,   floats: true },    // CRYSTAL
  { maxDist: 3000, perChunk: 2,  top: 3,   root: 0,   floats: true },    // SAUCER
  { maxDist: 3000, perChunk: 1,  top: 6,   root: 6,   floats: false },   // SEARCHLIGHT
  { maxDist: 1200, perChunk: 6,  top: 9,   root: 1.5, floats: false },   // TOTEM
  { maxDist: 3000, perChunk: 1,  top: 18,  root: 8,   floats: false },   // DISH
  { maxDist: 6000, perChunk: 1,  top: 100, root: 0,   floats: true },    // RING
  { maxDist: 3000, perChunk: 3,  top: 40,  root: 20,  floats: false },   // OBELISK
  { maxDist: 2000, perChunk: 1,  top: 20,  root: 6,   floats: false },   // DOME
  { maxDist: 2000, perChunk: 2,  top: 40,  root: 20,  floats: false },   // TURBINE
  { maxDist: 2000, perChunk: 1,  top: 16,  root: 8,   floats: false },   // CASSETTE
  { maxDist: 1200, perChunk: 8,  top: 8,   root: 1.5, floats: false },   // CACTUS
  { maxDist: 800,  perChunk: 4,  top: 5,   root: 1,   floats: false },   // CHEVRON
] as const satisfies readonly ArchetypeSpec[];

export const ItemKind = { SHARD: 0, GATE: 1, SPIKE: 2, FENCE: 3, DRONE: 4, TRAFFIC: 5 } as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];
export const ITEM_KIND_COUNT = 6;
/** maxDist: draw reach. perChunk: T01 never emits more of it in one row. T05 sizes TRAFFIC's ring with 3 rear rows, capacity 116 (§6.5). */
export interface ItemSpec { readonly maxDist: number; readonly perChunk: number }
export const ITEM_SPEC = [
  { maxDist: 800,  perChunk: 12 },   // SHARD
  { maxDist: 1600, perChunk: 1 },    // GATE, including a checkpoint, which takes a normal gate's place
  { maxDist: 800,  perChunk: 4 },    // SPIKE
  { maxDist: 800,  perChunk: 2 },    // FENCE
  { maxDist: 800,  perChunk: 3 },    // DRONE
  { maxDist: 1600, perChunk: 4 },    // TRAFFIC
] as const satisfies readonly ItemSpec[];

export const RenderOrder = {
  SKY: -1000, MIRROR: -500, PROP: 0, SHIP: 10, TERRAIN: 100, ADDITIVE: 200, SPEED_LINES: 210,
} as const;

// ---- position ----
/** chunk is integer-valued in [0, CHUNK_LIMIT); local is in [0, CHUNK_LEN). */
export interface Travel { chunk: number; local: number }

// ---- world ----
/** createWorld throws RangeError on a non-integer seed, or on a periodChunks that is negative, non-integer or not a multiple of 8. Every function of chunk reduces it first, so k and k + periodChunks * n give identical bytes. */
export interface WorldOptions { seed: number; periodChunks: number }   // periodChunks 0 = aperiodic
/** §5.1. World seed when no ?seed= is given. It decides the opening, so T11 may retune it under §8. */
export const DEFAULT_SEED = 155;

export interface PropRow {
  chunk: number;
  readonly data: Float32Array;   // PROP_STRIDE * MAX_PROPS_PER_CHUNK
  readonly start: Uint16Array;   // ARCHETYPE_COUNT + 1; instances of a are start[a] .. start[a + 1] - 1
}
export interface ItemRow {
  chunk: number;
  readonly data: Float32Array;   // ITEM_STRIDE * MAX_ITEMS_PER_CHUNK
  count: number;
}
/** bendV adds a * q to x and c * q to y (§8.2), so c < 0 lowers far geometry. abs(a) <= 8e-5, or the fog bound of §6.4 fails. c = -1.2e-5 and vMax = 1500, constant [A]; vMax > 0 always. */
export interface BendState { a: number; c: number; vMax: number }
export type HeroMode = 0 | 1 | 2 | 3;   // banded sun, eclipse, ringed planet, wire moon
export const Objective = { GATES: 0, CHAIN: 1, GRAZES: 2, NO_HIT: 3, BOOST: 4 } as const;
export type Objective = (typeof Objective)[keyof typeof Objective];
export interface ZoneState {
  index: number;
  biomeA: number; biomeB: number; biomeMix: number;
  paletteA: number; paletteB: number; paletteMix: number;
  readonly palette: Float32Array;   // PALETTE_FLOATS, linear, crossfaded in OKLab
  // The palette crossfade uses OKLab's polar form, OKLCh: lerp L and C, shortest arc on hue, per slot (§6.8). Nobody re-mixes it.
  heroA: HeroMode; heroB: HeroMode; heroMix: number;
  // objectiveTarget is an integer: GATES count, CHAIN consecutive shards, GRAZES count, NO_HIT u, BOOST u. SimState.objectiveProgress uses the same unit.
  // biomeB, paletteB, heroB always hold the next zone's value; ignore them at mix 0. musicKey is an integer semitone offset in [0, 12).
  objective: Objective; objectiveTarget: number; musicKey: number;
  // dayPhase is a sawtooth in [0, 1), and 0 is deepest night. Consumers evaluate cos(TAU * dayPhase), so the wrap cannot pop.
  // T06 applies exposure from dayPhase in post, so sky, fog and props move together. T04 applies it only to stars, nebula, aurora and meteors.
  dayPhase: number;
}
/** Pure and allocation-free: same seed and arguments give the same output, in any call order. */
export interface WorldSource {
  readonly seed: number;
  // iz may be negative near chunk 0. Exactly 0 at abs(x) <= VALLEY_HALF, never negative, continuous across chunks and zones. T01 memoises one row, so call a whole row at a time.
  /** True height at (x, iz * zs + zLocal). zs is a power of two; iz is integer-valued; zLocal is in [0, zs). */
  height(x: number, iz: number, zs: number, zLocal: number): number;
  /** Chunk may be any integer below 2^48, negative included. out.chunk is set to chunk as passed. Row contents never depend on out's prior contents. */
  fillProps(chunk: number, out: PropRow): void;
  fillItems(chunk: number, out: ItemRow): void;
  zoneAt(at: Readonly<Travel>, out: ZoneState): ZoneState;
  bendAt(at: Readonly<Travel>, out: BendState): BendState;
}

// ---- input ----
/**
 * One sample per rendered frame (§3.3 step 3); the sim reuses it for every step of that frame.
 * absolute false: moveX, moveY are steering rates in [-1, 1].
 * absolute true: moveX, moveY are a target in [-1, 1] across the play window, x = moveX * PLAY_HALF_X,
 *   y = PLAY_Y_MIN + (moveY + 1) / 2 * (PLAY_Y_MAX - PLAY_Y_MIN). The sim approaches it at its own bounded rate.
 * +moveX is sim +x and screen right. +moveY is sim +y and screen up.
 * boost: held this frame. human: a device event arrived since the last sample, or a key, button or finger is held.
 */
export interface ControlFrame { moveX: number; moveY: number; absolute: boolean; boost: boolean; human: boolean }
export interface InputSource { attach(el: HTMLElement): void; sample(out: ControlFrame): void; detach(): void }

// ---- sim ----
export const SimMode = { DEMO: 0, PLAY: 1, CRUISE: 2, SIGNAL_LOST: 3 } as const;
export type SimMode = (typeof SimMode)[keyof typeof SimMode];
/**
 * EventBuffer fields. x, y: ship position in u when the event fired.
 * value: SHARD, GATE, GRAZE points added including multipliers, 0 when cosmetic; HIT shields remaining; SECTOR new sector index; GRADE bonus points; others 0.
 * index: GRADE rank, 0 S, 1 A, 2 B, 3 C; otherwise the item's record ordinal in its row, or 0 if none.
 * chunk: the item's row chunk as passed to fillItems, or travel.chunk if there is no item.
 */
export const Ev = {
  SHARD: 1, GATE: 2, GATE_MISS: 3, GRAZE: 4, HIT: 5, SIGNAL_LOST: 6, SECTOR: 7, GRADE: 8, BOOST_ON: 9, BOOST_OFF: 10,
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];
/** Appended by sim.step, cleared by app at the end of the frame. Overflow drops events, never rules. */
export interface EventBuffer {
  readonly kind: Uint8Array; readonly x: Float32Array; readonly y: Float32Array; readonly value: Float32Array;
  readonly chunk: Float64Array; readonly index: Uint16Array;
  count: number;
}
/**
 * beat = tick / 72, fractional, unaffected by warp, mode and hit-stop. score is integer-valued, 0 until launch, and reset only by launch. overdrive in [0, 1]. ghost: seconds of immunity left.
 * autopilot is true whenever the planner steers, so the idle tag is mode === PLAY && autopilot. sectorIndex is zoneAt(travel).index, so it can lead FrameView.zone.index by one frame; HUD and audio read the zone.
 * sim.state, sim.events and state.travel are stable objects, mutated in place.
 */
export interface SimState {
  tick: number;            // integer-valued, never reset
  travel: Travel;
  stepDist: number;        // distance of the last step, always > 0; used for interpolation
  speed: number;
  x: number; y: number; prevX: number; prevY: number;
  mode: SimMode;
  score: number; sync: number; shields: number; overdrive: number; ghost: number;
  beat: number;
  sectorIndex: number; objectiveProgress: number;
  autopilot: boolean;
  warpSerial: number;      // incremented by warpTo; layers rebuild when it changes
}
/** launch works from DEMO only, pause from PLAY only, resume from CRUISE only. Anything else is a silent no-op. */
export type SimCommand = 'launch' | 'pause' | 'resume';
export interface Sim {
  readonly state: Readonly<SimState>;
  readonly events: EventBuffer;
  step(c: Readonly<ControlFrame>): void;
  command(c: SimCommand): void;
  // On success it rebuilds its own item rows, emits no event, leaves tick, mode and score alone, and warpSerial rises by 1.
  /** Returns false and changes nothing unless chunk is an integer in [0, CHUNK_LIMIT) and local in [0, CHUNK_LEN). */
  warpTo(chunk: number, local: number): boolean;
  /** Scales cruise, boost and the speed floor by 0.6 when on. Never stops motion. */
  setReducedMotion(on: boolean): void;
  /** Harness only. In PLAY, acts as if shields just reached 0; no-op in any other mode. */
  forceSignalLost(): void;
}

// ---- feel ----
/**
 * shakeX, shakeY, roll: radians; roll is three's rotation.z, negative banks right. shakeX is a small transient yaw, the one exception to §6.1. fovDeg: [58, 68]. aberration: [0, 1], maps across §6.6's range.
 * flash: [0, 0.6]. speedLines: [0, 1], the fraction of lines shown. bloomGain: multiplier in [1, 1.25]; T06 clamps it to [0, 1.5], so a harness override of 0 removes bloom. glitch: [0, 1]. shipHold: seconds, > 0 means hold ship and HUD animation.
 * duck: [0, 1], 1 at a hit, linear to 0 over 0.4 s. Audio does not read it: T07 schedules its own duck from Ev.HIT on the audio clock. Neutral values are createNeutralFeel().
 */
export interface FeelState {
  shakeX: number; shakeY: number; roll: number; fovDeg: number; aberration: number; flash: number;
  speedLines: number; bloomGain: number; duck: number; shipHold: number; glitch: number;
}
export interface Feel {
  readonly out: Readonly<FeelState>;
  update(dt: number, s: Readonly<SimState>, e: EventBuffer, reducedMotion: boolean): void;
}

// ---- quality ----
export type Tier = 0 | 1 | 2 | 3 | 4;
export type PostVariant = 'full' | 'noCa' | 'min' | 'bare';
/** One row of §6.10 per tier; T06 owns the table. maxPixels are exact: 3686400, 2073600, 1440000, 921600, 230400. Tier 0 has dprCap 1 and bloomLevels 0. nebulaWidth 0 means off, and target height is width / 2. */
export interface QualityProfile {
  tier: Tier;
  dprCap: number; maxPixels: number; msaa: 0 | 2 | 4;
  mirror: boolean; post: PostVariant; bloomLevels: number;
  nebulaWidth: number;             // 0 = off
  propDensity: number;
  terrainStride: 1 | 2;
  speedLines: number;
}
export interface Governor {
  readonly profile: Readonly<QualityProfile>;
  // sample(0) is a no-time tick: it returns a pending force once and adds to no statistic. Deltas of 1000 ms or more are ignored as stalls.
  /** Feed one rAF delta; returns the new tier when it changed, otherwise null. */
  sample(frameMs: number): Tier | null;
  /** Updates profile at once; the next sample() returns the new tier once, so app/ applies every change in one place. 'auto' keeps the current tier and resumes control, except on software, which returns to tier 0. */
  force(t: Tier | 'auto'): void;
}

// ---- the per-frame view: one object, mutated in place, never retained by a layer ----
export interface FrameView {
  // dt: clamped rAF delta in s, 0 under renderState, and no layer depends on it: ramps count frames or ticks. tick: integer-valued, never reset. cam can read chunk -1 for one frame after warpTo(0, 0).
  dt: number; tick: number; alpha: number;
  readonly cam: Travel;            // interpolated
  camX: number; camY: number;      // render-space; camera z is always 0
  readonly phases: Float32Array;   // PHASE_COUNT
  readonly sim: Readonly<SimState>;
  readonly feel: Readonly<FeelState>;
  readonly zone: Readonly<ZoneState>;
  readonly bend: Readonly<BendState>;
  readonly events: EventBuffer;
  quality: Readonly<QualityProfile>;
  reducedMotion: boolean;
}

// ---- rendering ----
// writeSharedUniforms writes all but uFog, which stays as created: uTravel = (cam.local, travelMod(cam, 4096)), uCamRow = rowMod(cam.chunk), uHero = (heroA, heroB, heroMix). Under v.reducedMotion it writes uBend = (0, 0, vMax), so neither app/ nor a layer repeats §10.3's bend-off.
/** One object per uniform; spread by reference into every ShaderMaterial. Names match glsl/common.glsl. */
export interface SharedUniforms {
  uTravel: { value: Float32Array };   // vec2
  uCamRow: { value: number };
  uPhases: { value: Float32Array };   // vec4[2]
  uBend: { value: Float32Array };     // vec3: a, c, vMax
  uPal: { value: Float32Array };      // vec3[7], flat
  uFog: { value: Float32Array };      // vec2: start, end
  uHero: { value: Float32Array };     // vec3: modeA, modeB, mix
}
export interface RenderContext {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly shared: SharedUniforms;
  readonly world: WorldSource;
}
export type LayerName = 'sky' | 'terrain' | 'props' | 'fx';
// The harness hides the other layers and sets the clear colour and zero pitch; terrain only swaps materials, and other layers ignore the mode. Debug materials compile on first use, in harness runs only.
/** 'crack': flat-shaded terrain for the crack test. 'edge-paint': terrain boundary rows painted for the fog-bound test. */
export type DebugMode = 'none' | 'crack' | 'edge-paint';
/** Cells added to each coarse hole by the crack test's negative control (§11.3). At this value the crack test must fail. */
export const CRACK_CONTROL_GROW = 4;
/**
 * Canvas output of the terrain debug modes. Clear to CLEAR first. RGB 0-255 tests:
 * sky is R > 200, G < 60, B > 200. EDGE_OK is G > 200, R < 60. EDGE_BAD is R > 200, G < 60, B < 60.
 * FLAT is below the bloom threshold, so the sky test also works post-on at MSAA 0.
 */
export const DebugPaint = {
  CLEAR: 0xff00ff, FLAT: [0.1, 0.6, 0.3], EDGE_OK: [0, 1, 0], EDGE_BAD: [1, 0, 0], EDGE_INTERIOR: [0.1, 0.1, 0.1],
} as const;
/**
 * Lifecycle: attach in array order (sky, terrain, props, fx) and setQuality; then post.attach, post.setQuality, post.resize, await post.precompile(); then rebuild once on every layer before the first frame.
 * Every mesh exists after attach, and nothing adds a mesh or flips transparent or side afterwards. After timed boot frames app/ may call setQuality and rebuild once more.
 * setQuality comes from §3.3 step 15 at any rate, including mid-ramp from the quality menu, and never while the context is lost. The first call and every rebuild apply at once, with no ramp.
 * frame self-heals after a camera jump, but app/ and the dev shell call rebuild first on any backward move or forward jump over CHUNK_LEN. A rebuild from equal rows gives the same slot order, whatever came before.
 * frame may render to the layer's own target and must restore what getRenderTarget returned.
 */
export interface RenderLayer {
  readonly name: LayerName;
  attach(ctx: RenderContext): void;
  setQuality(q: Readonly<QualityProfile>): void;
  /** Bounded work: at most 1 fillProps, and terrain rows only as crossed. */
  frame(v: Readonly<FrameView>): void;
  /** After a warp or a context restore: clear updateRanges, refill from pure state, mark for full upload. */
  rebuild(v: Readonly<FrameView>): void;
  /** Harness only. Hides every mesh of this layer. */
  setVisible(on: boolean): void;
  /** Harness only. A layer that a mode does not concern ignores it. */
  setDebugMode(m: DebugMode): void;
  /** Harness only, terrain only: grows the coarse holes by this many cells; 0 restores the real mesh. */
  setCrackControl?(holeGrow: number): void;
  dispose(): void;
}
/** The frame owner (app/ or the dev shell), not PostStack, owns renderer.info.reset and autoReset, debug.onShaderError, renderer flags, camera.aspect and updateProjectionMatrix. PostStack alone writes pixel ratio, renderer and composer size, and toneMappingExposure. */
export interface PostStack {
  attach(ctx: RenderContext): void;
  /** Renders every variant once, so no program compiles mid-game. Call behind the title. */
  precompile(): Promise<void>;
  /** setQuality and resize only record. They apply at the start of the next frame, render or precompile, so GL is never touched while the context is lost. resize applies the §6.10 pixel-ratio formula, and app/ takes devicePixelRatio from window. */
  setQuality(q: Readonly<QualityProfile>): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  frame(v: Readonly<FrameView>): void;
  render(dt: number): void;
  /** Cheap and GL-free, safe on every warp. After a context restore, call precompile again as well, and only with a live context. */
  rebuild(): void;
  // Both forces survive setQuality and apply at the next frame or render. Scan and grain follow the active variant, not the tier.
  /** Harness only; null returns to the quality profile. Under 'off', render() draws the scene straight to the canvas with autoClear on. */
  forceVariant(v: PostVariant | 'off' | null): void;
  /** Harness only; null returns to the quality profile. */
  forceMsaa(n: 0 | 2 | 4 | null): void;
  dispose(): void;
}

// ---- audio ----
/**
 * unlock: inside an activating event, in the same call stack. Idempotent. Never rejects; resolves when running or after 1 s, so never await it before launching. Retry on later gestures is internal.
 * frame: every frame in every mode, before events are cleared; a no-op until unlocked. Never throws.
 * setVolume: linear gains in [0, 1], callable before unlock. Mute is setVolume(0, 0).
 * suspend, resume: tab hidden and shown (§10.4). Idempotent, safe before unlock. dispose: on the fatal page; every method is then a no-op.
 */
export interface AudioEngine {
  /** Must be called inside a user gesture. */
  unlock(): Promise<void>;
  frame(v: Readonly<FrameView>): void;
  setVolume(music: number, sfx: number): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

// ---- ui ----
/**
 * launch runs synchronously inside an activating event and may fire more than once for one gesture:
 *   it must unlock audio in the same call stack, be idempotent, and do nothing to the sim outside DEMO.
 * togglePause: PLAY to CRUISE, CRUISE to PLAY, otherwise nothing. setQuality(t) means governor.force(t). setReducedMotion writes the sim and FrameView.reducedMotion together.
 * Ui.mount calls setVolume and setReducedMotion at once, and setQuality if a stored choice exists, before the renderer and the final governor exist. app/ routes the first two to live objects and buffers setQuality until boot ends.
 * Ui is the only reader of prefers-reduced-motion and the only owner of localStorage bests. Ui.showFatal may be called before mount.
 */
export interface UiCommands {
  launch(): void;
  togglePause(): void;
  setQuality(t: Tier | 'auto'): void;
  setVolume(music: number, sfx: number): void;
  setReducedMotion(on: boolean): void;
}
export type FatalReason = 'no-webgl2' | 'context-lost-permanent' | 'shader-error' | 'runtime-error';
/** mount(root): root is an empty element above the canvas, never transformed, and input attaches to the canvas itself. DOM hooks for tests, as data-mv values: title, launch, hud, km, sector, cruise, resume, signal-lost, context-lost, autopilot, reduced, quality, fatal, reload. <html data-mv-mode> is demo, play, cruise or lost. The UI writes no bests once warpSerial is non-zero. */
export interface Ui {
  mount(root: HTMLElement, cmd: UiCommands): void;
  frame(v: Readonly<FrameView>): void;
  showContextLost(lost: boolean): void;
  showFatal(r: FatalReason): void;
}

// ---- harness (window.__mv when the page is opened with ?harness) ----
export interface HarnessStats {
  calls: number; triangles: number; geometries: number; textures: number; programs: number;
  /** chunk and local are the sim's travel, which renderAt does not move. tier is governor.profile.tier, which changes as soon as a force is made. */
  chunk: number; local: number; tier: Tier;
  /** Drawing buffer size in pixels, the shape of pixels(). */
  width: number; height: number;
  tick: number; warpSerial: number; mode: SimMode;
}
/**
 * Real page query, read only by app/. ?harness enables window.__mv. Under it ?period=<n> sets WorldOptions.periodChunks, default 1024, 0 = aperiodic. In any mode, ?seed=<int> overrides DEFAULT_SEED, and ?tier=0..4 sets CreateGovernor.forced with no boot timing. A bad value warns and falls back.
 * The periodic world holds only zones 0 to 10 and jumps at multiples of 1024, so judge no picture across a wrap, and use ?period=0 to reach all 36 palette and biome pairs.
 * Wash-out metrics on final 8-bit RGBA, one meaning for T06, T09 and T11 (§6.7). Near-white: share of pixels with min(r, g, b) > 235. Mean chroma: mean of max - min. Haze lift: mean Rec.709 luma of the frame minus the same frame under forceFeel({ bloomGain: 0 }), whole frame.
 * blackP10: nearest-rank 10th percentile of rounded Rec.709 luma, whole frame. Limits and negative controls are in §6.7.
 */
export interface HarnessApi {
  readonly ready: boolean;
  /** Stops the rAF loop; the harness then drives frames explicitly. */
  manual(on: boolean): void;
  warp(chunk: number, local: number): boolean;
  /** Renders exactly this world state with neutral feel. Returns GPU-synced ms. */
  renderAt(chunk: number, local: number, tick: number): number;
  stepFrames(n: number, dt: number): void;
  setPost(variant: PostVariant | 'off'): void;
  setMsaa(n: 0 | 2 | 4): void;
  setLayerVisible(name: LayerName, on: boolean): void;
  setCrackMode(on: boolean): void;
  setEdgePaint(on: boolean): void;
  /** Negative control for setCrackMode: while on, holes are grown by CRACK_CONTROL_GROW, and the crack count must be non-zero. */
  setCrackControl(on: boolean): void;
  /** Changes palette, hero and the sky's biome key only. Terrain and props follow the chunk's real biome, so to see a true pair, warp to a real chunk. */
  forceZone(palette: number, biome: number, hero: HeroMode): void;
  forceBend(a: number, c: number): void;
  /** Overrides feel's FOV, including under renderAt; null clears. The fog-bound test uses CAMERA_FOV_MAX. */
  forceFov(deg: number | null): void;
  /** Overrides feel fields, including under renderAt; null clears. { shakeY: -CAMERA_PITCH } gives zero pitch, { bloomGain: 0 } removes bloom. */
  forceFeel(o: Partial<FeelState> | null): void;
  /** Calls governor.force. stats().tier changes at once; layers and post apply it at step 15 of the next renderAt or stepFrames frame, so it shows from the frame after. 'auto' returns control to the governor. */
  setTier(t: Tier | 'auto'): void;
  /** Reaches SIGNAL_LOST through sim.forceSignalLost(). PLAY only. */
  forceSignalLost(): void;
  /** Resolves one macrotask after webglcontextlost. Rejects if already lost. */
  loseContext(): Promise<void>;
  /** Resolves on webglcontextrestored. Rejects, touching no GL, unless a loseContext promise has resolved (§11.3). */
  restoreContext(): Promise<void>;
  stats(): HarnessStats;
  /** Full-frame RGBA read in the same task as the render. */
  /** Rows are bottom-up, as gl.readPixels gives them. Throws unless in the same synchronous run as renderAt or stepFrames. renderAt and stepFrames throw unless manual(true). */
  pixels(): Uint8Array;
}
/*
 * Boot: app/ imports src/harness dynamically, only under ?harness, and calls createHarness(host) once, after boot and one real frame. createHarness installs window.__mv and window.__mvLab and returns the API.
 * app/ then logs console.info('MV_READY') once, which is the only wait that does not grant user activation.
 * runFrame(dt): the §3.3 body with rawDt = dt, stepping the sim. Step 2 calls governor.sample(0), so a synthetic dt reaches no statistic.
 * renderState(chunk, local, tick): §3.3 steps 2 and 5 to 15, with no input, sim step or feel.update: cam is exactly (chunk, local), tick is tick, alpha 0, dt 0, phases at alpha 0, camX and camY from prevX and prevY,
 *   neutral feel plus overrideFeel, post.render(0), sim unchanged, so the ship holds still. Step 10 rebuilds if warpSerial changed, and any backward camera move or forward jump over CHUNK_LEN rebuilds every layer and post first. A forward step within CHUNK_LEN streams as in play.
 * In both, a Governor.force applies at step 15 and shows from the next frame, held while the context is lost; a throw goes to the fatal route and is then rethrown. Overrides persist until cleared.
 * Methods on sim, layers and post are reached by property lookup, never a captured reference, and those objects are not frozen, so the harness may wrap them.
 */
/** What app/ hands the harness. The harness imports no sibling module, so this is everything it may touch. */
export interface HarnessHost {
  readonly sim: Sim;
  readonly ctx: RenderContext;
  readonly layers: readonly RenderLayer[];
  readonly post: PostStack;
  readonly governor: Governor;
  /** true stops the rAF loop; false restarts it. */
  setManual(on: boolean): void;
  /** One pass of the frame loop (§3.3) at this dt, stepping the sim. */
  runFrame(dt: number): void;
  /** The frame loop without stepping the sim, at exactly this state, with alpha 0 and neutral feel. */
  renderState(chunk: number, local: number, tick: number): void;
  /** Applied straight after step 7 of §3.3. null clears. */
  overrideZone(o: { palette: number; biome: number; hero: HeroMode } | null): void;
  overrideBend(o: { a: number; c: number } | null): void;
  /** Replaces feel.out.fovDeg in step 9 of §3.3. null clears. */
  overrideFov(deg: number | null): void;
  /** Merged over feel.out in runFrame and over neutral feel in renderState; overrideFov wins on fovDeg. null clears. */
  overrideFeel(o: Partial<FeelState> | null): void;
}

// ---- composition root: each module exports only its factories, from its index.ts (src/render/fx has three, the rest one) ----
// For src/app and tests only, outside the factories: writePalette from src/world/palettes.ts (overrideZone), findZoneChunk from src/world/zones.ts (tests/art).
export type CreateWorld = (o: WorldOptions) => WorldSource;         // src/world/index.ts        createWorld
export type CreateSim = (w: WorldSource) => Sim;                    // src/sim/index.ts          createSim
export type CreateFeel = () => Feel;                                // src/feel/index.ts         createFeel
export type CreateLayer = () => RenderLayer;                        // createSkyLayer, createTerrainLayer, createPropsLayer, createFxLayer, each from its src/render/<name>/index.ts
export type CreatePost = () => PostStack;                           // src/render/fx/index.ts    createPost
/** forced beats software. software comes from the unmasked WEBGL_debug_renderer_info string, and pins tier 0 under 'auto'. bootP95Ms is milliseconds of the readPixels-synced boot frames at tier 3; not finite or not above 0 means no measurement. */
export type CreateGovernor = (o: { software: boolean; bootP95Ms: number; forced: Tier | null }) => Governor;  // src/render/fx/index.ts
export type CreateAudio = () => AudioEngine;                        // src/audio/index.ts        createAudio
export type CreateUi = () => Ui;                                    // src/ui/index.ts           createUi
export type CreateInput = () => InputSource;                        // src/input/index.ts        createInput
export type CreateHarness = (h: HarnessHost) => HarnessApi;         // src/harness/index.ts      createHarness
