// The props RenderLayer. Every mesh is added in attach and none after: 26 rings, 12 mirrors, 2 beams, 2 ship draws and,
// since T13, the cockpit's one, which shows only in the cockpit view, where the ship's two do not.
// Streaming goes through feeder.ts, the tier ramp through density.ts. Nothing in frame() allocates beyond addUpdateRange's one
// object per range, at chunk rate.
import { BufferAttribute, BufferGeometry, Group, Mesh, type InstancedBufferAttribute, type ShaderMaterial, type WebGLRenderer } from 'three';
import {
  Archetype, Ev, ItemKind, ROW_MOD, SHIP_FORWARD, SimMode,
  type LayerName, type QualityProfile, type RenderContext, type RenderLayer, type FrameView,
} from '../../contracts/index';
import { COCKPIT_REF_ASPECT } from '../../core/cockpit';
import { ARCHETYPE_DEFS, Look, Motion, type LookDef, type MeshDef } from './archetypes';
import { buildUnitBox, MeshBuilder, type BuiltMesh } from './builders';
import { DensityMachine, ringClamp, ringFilter, ringModulus, type DensityPhase } from './density';
import { createFeeder, type Feeder } from './feeder';
import { ITEM_DEFS } from './items';
import {
  cockpitMaterial, createCockpitUniforms, type CockpitUniforms,
  createLayerUniforms, createShipUniforms, propMaterial, RENDER_ORDER, ringLookUniforms, shipMaterial, type LayerUniforms, type ShipUniforms,
} from './material';
import { RING_COUNT, RING_PLAN, type RingPlanEntry } from './plan';
import { RingGpu } from './ringGpu';
import { buildShipBody, buildShipGlow, createShipPlane, createShipPose, SHIP_HALF_LENGTH, shipPlane, shipPose } from './ship';
import { buildCockpit, createYokePose, yokePose } from './cockpit';

export interface PropsLayerOptions {
  debug?: boolean;          // exposes PropsDebug at layer.debug
  naiveEdges?: boolean;     // #define NAIVE_EDGES, the shimmer negative control
  silhouette?: boolean;     // #define SILHOUETTE, opaque black, used by the silhouette sheet
  placeholder?: boolean;    // every ring draws a still unit box: uMotion off and no phase-driven look, so only density changes its pixels
  ship?: boolean;           // default true. False hides the ship's two draws, so a test can isolate one object (DI-43)
  plan?: readonly RingPlanEntry[];
  /** Dev sheets only: a grounded mesh's root collapses to its ground line, so a tile with no floor shows what the player would. */
  clipRoots?: boolean;
  /** Tests only (A15): #define MIRROR_PROBE on the mirror program, red where a reflected fragment is above the floor plane. */
  mirrorProbe?: boolean;
}

export interface PropsDebug {
  ring(id: number): { cap: number; modulus: number; head: number; liveRecords: number; visible: boolean; instanceCount: number; filter: number; truncated: number };
  counts(): { fillProps: number; fillItems: number; rebuilds: number; catchUps: number; refills: number; hides: number };
  density(): { current: number; target: number; phase: DensityPhase };
  /** Pending update ranges on a ring's buffer (A10). */
  pendingRanges(id: number): number;
  /** Sheet tools: the ship's own tile, and how far ahead it sits there. */
  setShipVisible(on: boolean): void;
  setShipForward(forward: number): void;
  /** A22's negative control: the orb's far fade off. */
  setOrbFade(on: boolean): void;
  /** A12's negative control: the density shrink window, .03 by default. A tiny value makes each record pop in one frame. */
  setDensityWindow(w: number): void;
  /** Sheet tools: a tile with no floor must not show the mirror under it, nor cut RING at the floor line (uRingCut). */
  setMirrorAllowed(on: boolean): void;
  /** A6n's negative control reaches a ring's buffer. */
  buffer(id: number): InstancedBufferAttribute;
  readonly feeder: Feeder | null;
}

/** A distinct flat colour per ring, for placeholders: nothing about a placeholder moves except with density. */
function flatColour(id: number): readonly [number, number, number] {
  const a = (id * 0.381966) % 1;
  return [0.35 + 0.65 * Math.abs(Math.sin(6.283 * a)), 0.35 + 0.65 * Math.abs(Math.sin(6.283 * (a + 0.33))), 0.35 + 0.65 * Math.abs(Math.sin(6.283 * (a + 0.66)))];
}

const HAZARD_KINDS: ReadonlySet<number> = new Set<number>([ItemKind.SPIKE, ItemKind.FENCE, ItemKind.DRONE, ItemKind.TRAFFIC]);
const PLACEHOLDER_LOOK: LookDef = {
  look: Look.FLAT, motion: Motion.NONE, tints: [6, 6, 6], bodyL: 1, edgeL: 0, edgeW: 0, yaw: false, grounded: false,
};
const GHOST_RAMP_TICKS = 60;

/**
 * Props draws between two gl.flush() calls (A30). Without a flush, Chrome hands a frame's commands to its GPU process only at the
 * frame's sync, so ANGLE's per-draw work for 42 instanced draws ran after the JS that issued them instead of beside it. Measured on
 * A30's loop: none 1.48 to 1.54 ms mean, every 12 draws 1.06 to 1.08, every 4 no better than none and every draw twice as slow
 * (plan section 10). Counted from each frame(), so a frame flushes at the same draws every time. A flush changes no pixel.
 */
const FLUSH_EVERY = 12;

/** DI-85: tier 0 draws the sky's plain sun in every hero mode, so the orb's reflection must too (hero.glsl's switch). */
const TIER0_DEFINES = { HERO_SUN_ONLY: '1' } as const;

function built(def: MeshDef): BuiltMesh {
  const b = new MeshBuilder();
  def.build(b);
  return b.finish();
}

function builtBeam(def: MeshDef): BuiltMesh {
  const b = new MeshBuilder();
  def.buildBeam!(b);
  return b.finish();
}

export function createPropsLayer(o: PropsLayerOptions = {}): RenderLayer & { readonly debug?: PropsDebug } {
  const plan = o.plan ?? RING_PLAN;
  const root = new Group();
  root.name = 'props';
  const flags = {
    naive: o.naiveEdges ?? false, silhouette: o.silhouette ?? false, clipRoots: (o.clipRoots ?? false) || (o.silhouette ?? false), mirrorProbe: o.mirrorProbe ?? false,
  };
  const placeholder = o.placeholder ?? false;
  const layerU: LayerUniforms = createLayerUniforms();
  const shipU: ShipUniforms = createShipUniforms();
  const density = new DensityMachine();
  const filters = new Float32Array(RING_COUNT).fill(1);
  const pose = createShipPose();
  const plane = createShipPlane();
  // T13: the cockpit, one more draw, shown only while the frame says some of it is in.
  const cockpitU: CockpitUniforms = createCockpitUniforms();
  const yoke = createYokePose();
  let cockpit: Mesh | null = null;
  let cockpitMat: ShaderMaterial | null = null;
  const counts = { fillProps: 0, fillItems: 0, rebuilds: 0, catchUps: 0, refills: 0, hides: 0 };

  let ctx: RenderContext | null = null;
  let feeder: Feeder | null = null;
  let rings: RingGpu[] = [];
  let shipBody: Mesh | null = null;
  let shipGlow: Mesh | null = null;
  const shipGeos: BufferGeometry[] = [];
  const shipMats: ShaderMaterial[] = [];
  let lastChunk = Number.NaN;
  let quality: Readonly<QualityProfile> | null = null;
  let requested: Readonly<QualityProfile> | null = null;
  let shipOn = o.ship ?? true;
  let shipForward = SHIP_FORWARD;
  let mirrorAllowed = true;
  let flashStart = -1;
  let flashRow = -1;
  let ghostTarget = 0;
  let ghostFrom = 0;
  let ghostStart = 0;
  let ghostValue = 0;
  let drawsSinceFlush = 0;
  let sunOnly = false;

  // One function for every props mesh, made once: three calls it after each draw it issues, so hidden meshes do not count.
  function afterDraw(renderer: WebGLRenderer): void {
    if (++drawsSinceFlush < FLUSH_EVERY) return;
    drawsSinceFlush = 0;
    renderer.getContext().flush();
  }

  /** Every props material, rings and ship. */
  function forEachMaterial(fn: (m: ShaderMaterial) => void): void {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      fn(r.mesh.material as ShaderMaterial);
      if (r.mirrorMesh) fn(r.mirrorMesh.material as ShaderMaterial);
      if (r.beamMesh) fn(r.beamMesh.material as ShaderMaterial);
    }
    for (const m of shipMats) fn(m);
  }

  /**
   * DI-85: the tier-0 program, chosen at the first setQuality, before precompile, as T03's floor and T04's sky choose theirs. Defined on
   * every props material, not the orb's alone, so tier 0 keeps the same 6 programs; only the ORB look calls sunDisc, so no other look
   * changes. A define is in the program key, so it is never flipped afterwards: a later tier change keeps whichever program booted.
   */
  function applySunOnly(): void {
    forEachMaterial((m) => {
      m.defines = { ...m.defines, ...TIER0_DEFINES };
      m.needsUpdate = true;   // none is compiled yet at this point of the lifecycle; this keeps it right if one were
    });
  }

  function defFor(entry: Readonly<RingPlanEntry>): MeshDef {
    return (entry.source === 'prop' ? ARCHETYPE_DEFS[entry.kind] : ITEM_DEFS[entry.kind])!;
  }

  function applyDensityAtOnce(d: number): void {
    density.applyNow(d);
    layerU.uDensity.value = density.current;
    if (!feeder) return;
    for (let i = 0; i < RING_COUNT; i++) {
      const p = plan[i]!;
      const ring = feeder.rings[i]!;
      const f = ringFilter(p, d);
      ring.setDensity(f, ringClamp(p, d), ringModulus(p, d));
      filters[i] = f;
    }
  }

  function applyMirror(q: Readonly<QualityProfile>): void {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      r.mirrorOn = q.mirror && mirrorAllowed;
      r.syncVisible();
    }
  }

  function rebuildAll(chunk: number): void {
    feeder!.rebuild(chunk);
    for (let i = 0; i < rings.length; i++) {
      rings[i]!.store.fullDirty = false;
      rings[i]!.requestFull();
      rings[i]!.syncCount();
      rings[i]!.syncVisible();
    }
    lastChunk = chunk;
  }

  const layer: RenderLayer & { readonly debug?: PropsDebug } = {
    name: 'props' as LayerName,

    attach(c: RenderContext): void {
      ctx = c;
      // The world is read through a counter, made once here, so counts() reports what really ran.
      const world = c.world;
      feeder = createFeeder({
        fillProps(chunk, out) { counts.fillProps++; world.fillProps(chunk, out); },
        fillItems(chunk, out) { counts.fillItems++; world.fillItems(chunk, out); },
      }, plan);
      const unit = placeholder ? buildUnitBox() : null;
      const list: RingGpu[] = [];
      for (let i = 0; i < plan.length; i++) {
        const entry = plan[i]!;
        const def = defFor(entry);
        const lookDef: LookDef = placeholder ? PLACEHOLDER_LOOK : def;
        const hazard = entry.source === 'item' && HAZARD_KINDS.has(entry.kind);
        const flat = flatColour(i);
        const unitItem = placeholder && entry.source === 'item';
        const normalFamily = !placeholder && entry.source === 'prop' && entry.kind === Archetype.CASSETTE ? 'cutout' : 'normal';
        // A searchlight has only its additive cone: no opaque housing, so it stays one draw.
        const additiveOnly = !placeholder && entry.source === 'prop' && entry.kind === Archetype.SEARCHLIGHT;
        const family = additiveOnly ? 'additive' : normalFamily;
        const normal = propMaterial(family, c.shared, layerU, ringLookUniforms(lookDef, entry.maxDist, hazard, flat, unitItem), flags);
        const order = additiveOnly ? RENDER_ORDER.additive : RENDER_ORDER.normal;
        const mirror = entry.mirror
          ? { material: propMaterial('mirror', c.shared, layerU, ringLookUniforms(lookDef, entry.maxDist, hazard, flat, unitItem), flags), order: RENDER_ORDER.mirror }
          : null;
        const beam = entry.beam
          ? {
            mesh: placeholder ? unit! : builtBeam(def),
            material: propMaterial('additive', c.shared, layerU, ringLookUniforms(placeholder ? PLACEHOLDER_LOOK : def.beam!, entry.maxDist, hazard, flat, unitItem), flags),
            order: RENDER_ORDER.additive,
          }
          : null;
        list.push(new RingGpu(feeder.rings[i]!, placeholder ? unit! : built(def), normal, order, root, mirror, beam));
      }
      rings = list;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i]!;
        r.mesh.onAfterRender = afterDraw;
        if (r.mirrorMesh) r.mirrorMesh.onAfterRender = afterDraw;
        if (r.beamMesh) r.beamMesh.onAfterRender = afterDraw;
      }

      const bodyMesh = buildShipBody();
      const glowMesh = buildShipGlow();
      const shipLook: LookDef = { look: Look.SHIP, motion: Motion.NONE, tints: [6, 6, 6], bodyL: 1.6, edgeL: 1.7, edgeW: 0.028, yaw: false, grounded: false };
      const glowLook: LookDef = { look: Look.SHIP_GLOW, motion: Motion.NONE, tints: [6, 6, 6], bodyL: 0, edgeL: 0, edgeW: 0, yaw: false, grounded: false };
      const makeGeo = (m: BuiltMesh): BufferGeometry => {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(m.position, 3));
        g.setAttribute('aEdge', new BufferAttribute(m.edge, 4));
        g.setAttribute('aUv', new BufferAttribute(m.uv, 2));
        g.setAttribute('aTag', new BufferAttribute(m.tag, 2));
        g.setIndex(new BufferAttribute(m.index, 1));
        g.computeBoundingSphere();
        shipGeos.push(g);
        return g;
      };
      const bodyMat = shipMaterial('shipBody', c.shared, layerU, shipU, ringLookUniforms(shipLook, 100, false, [1, 1, 1]), flags);
      const glowMat = shipMaterial('shipGlow', c.shared, layerU, shipU, ringLookUniforms(glowLook, 100, false, [1, 1, 1]), flags);
      shipMats.push(bodyMat, glowMat);
      shipBody = new Mesh(makeGeo(bodyMesh), bodyMat);
      shipBody.frustumCulled = false;
      shipBody.renderOrder = RENDER_ORDER.ship;
      shipGlow = new Mesh(makeGeo(glowMesh), glowMat);
      shipGlow.frustumCulled = false;
      shipGlow.renderOrder = RENDER_ORDER.additive;
      shipBody.visible = shipOn;
      shipGlow.visible = shipOn;
      shipBody.onAfterRender = afterDraw;
      shipGlow.onAfterRender = afterDraw;
      root.add(shipBody, shipGlow);
      // T13: added here with everything else, hidden, so boot's precompile links its program and a camera change links none.
      cockpitMat = cockpitMaterial(c.shared, cockpitU);
      cockpit = new Mesh(makeGeo(buildCockpit()), cockpitMat);
      cockpit.frustumCulled = false;
      cockpit.renderOrder = RENDER_ORDER.cockpit;
      cockpit.visible = false;
      cockpit.onAfterRender = afterDraw;
      root.add(cockpit);
      c.scene.add(root);
      // Only if a setQuality came first, which the lifecycle does not do.
      if (sunOnly) applySunOnly();
    },

    setQuality(q: Readonly<QualityProfile>): void {
      if (quality === null) {
        quality = q;
        sunOnly = q.tier === 0;
        if (sunOnly) applySunOnly();
        applyDensityAtOnce(q.propDensity);
        applyMirror(q);
        for (let i = 0; i < rings.length; i++) rings[i]!.syncCount();
        return;
      }
      requested = q;
      quality = q;
      applyMirror(q);
    },

    frame(v: Readonly<FrameView>): void {
      if (!feeder) return;
      const tick = v.tick;
      drawsSinceFlush = 0;
      layerU.uReduced.value = v.reducedMotion ? 1 : 0;
      // A pixel's size at a depth, for thin parts drawn at least a pixel wide (D-002). A plain property read: no allocation.
      if (ctx) layerU.uViewH.value = Math.max(1, ctx.renderer.getContext().drawingBufferHeight);

      // Tier change, as a pure function of the tick.
      if (requested) {
        density.request(requested.propDensity, tick);
        requested = null;
      }
      const toRefill = density.step(tick, plan, filters);
      layerU.uDensity.value = density.current;

      const c = v.cam.chunk;
      if (c !== lastChunk) {
        if (c === lastChunk + 1) {
          feeder.cross(c);
          lastChunk = c;
          for (let i = 0; i < rings.length; i++) rings[i]!.flush();
        } else {
          // Backwards, or more than one chunk: the same path as rebuild.
          counts.catchUps++;
          applyDensityAtOnce(density.target);
          rebuildAll(c);
          layerU.uDensity.value = density.current;
          counts.rebuilds++;
        }
      }

      if (toRefill >= 0 && density.phase === 'refill') {
        const p = plan[toRefill]!;
        const d = density.target;
        const f = ringFilter(p, d);
        feeder.refill(toRefill, f, ringClamp(p, d), ringModulus(p, d));
        filters[toRefill] = f;
        counts.refills++;
        rings[toRefill]!.flush();
      }

      // Events: each is seen once, because v.events is cleared after frame.
      const ev = v.events;
      for (let i = 0; i < ev.count; i++) {
        const kind = ev.kind[i]!;
        if (kind === Ev.SHARD) {
          feeder.hideItem(ev.chunk[i]!, ev.index[i]!);
          if (feeder.hideRing >= 0) {
            rings[feeder.hideRing]!.flushOne(feeder.hideFloat);
            counts.hides++;
          }
        } else if (kind === Ev.GATE) {
          flashStart = tick;
          const ch = ev.chunk[i]!;
          flashRow = ((ch % ROW_MOD) + ROW_MOD) % ROW_MOD;
        }
      }
      const flash = layerU.uGateFlash.value;
      if (flashStart >= 0) {
        const age = (tick - flashStart) / 120;
        if (age < 0 || age >= 1) {
          flashStart = -1;
          flash[0] = -1;
          flash[1] = 0;
        } else {
          flash[0] = flashRow;
          flash[1] = 1 - age;
        }
      }

      // CRUISE dims hazards by a ramp on the tick. A tick going backwards lands on the target at once.
      const wantGhost = v.sim.mode === SimMode.CRUISE ? 1 : 0;
      if (wantGhost !== ghostTarget) {
        ghostFrom = ghostValue;
        ghostTarget = wantGhost;
        ghostStart = tick;
      }
      if (ghostValue !== ghostTarget) {
        const k = tick < ghostStart ? 1 : Math.min(1, (tick - ghostStart) / GHOST_RAMP_TICKS);
        ghostValue = ghostFrom + (ghostTarget - ghostFrom) * k;
      }
      layerU.uGhost.value = ghostValue;

      // T13: where the ship plane is, now that the view origin can sit ahead of the sim's travel. With camAhead 0 these are
      // the values the uniforms were created with.
      shipPlane(shipForward, v, plane);
      layerU.uGateOpen.value = plane.gateOpen;
      const near = layerU.uNearShrink.value;
      near[0] = plane.nearLo;
      near[1] = plane.nearHi;
      near[2] = plane.droneLo;
      near[3] = plane.droneHi;
      const shipShown = shipOn && plane.visible;
      if (shipBody && shipBody.visible !== shipShown) shipBody.visible = shipShown;
      if (shipGlow && shipGlow.visible !== shipShown) shipGlow.visible = shipShown;

      // The ship, a pure function of sim, feel, alpha and the phases.
      shipPose(v.sim, v.feel, v.alpha, v.phases, pose);
      const shipPos = shipU.uShipPos.value;
      shipPos[0] = pose.x;
      shipPos[1] = pose.y;
      shipPos[2] = -plane.depth;
      const rot = shipU.uShipRot.value;
      rot[0] = pose.bank;
      rot[1] = pose.pitch;
      const eng = shipU.uShipEngine.value;
      eng[0] = pose.engine;
      eng[1] = pose.flicker;
      shipU.uShipBlink.value = pose.blink;

      // T13: the cockpit. Its unit is min(height, width / COCKPIT_REF_ASPECT) of the drawing buffer, which has the stage's
      // shape, so the UI's readouts, placed by the same rule in CSS pixels, land on the panels. The wheel takes the ship's pose.
      const cockpitShown = shipOn && v.cockpitIn > 0;
      if (cockpit && cockpit.visible !== cockpitShown) cockpit.visible = cockpitShown;
      if (cockpitShown && ctx) {
        const gl = ctx.renderer.getContext();
        const w = gl.drawingBufferWidth > 1 ? gl.drawingBufferWidth : 1;
        const h = gl.drawingBufferHeight > 1 ? gl.drawingBufferHeight : 1;
        const byWidth = w / COCKPIT_REF_ASPECT;
        const unit = h < byWidth ? h : byWidth;
        const cu = cockpitU.uCockpit.value;
        cu[0] = (2 * unit) / w;
        cu[1] = (2 * unit) / h;
        cu[2] = v.cockpitIn;
        cu[3] = pose.blink;
        yokePose(pose, yoke);
        const yk = cockpitU.uYoke.value;
        yk[0] = yoke.turn;
        yk[1] = yoke.pull;
      }
    },

    rebuild(v: Readonly<FrameView>): void {
      if (!feeder) return;
      applyDensityAtOnce(quality ? quality.propDensity : density.target);
      requested = null;
      rebuildAll(v.cam.chunk);
      counts.rebuilds++;
      ghostTarget = v.sim.mode === SimMode.CRUISE ? 1 : 0;
      ghostValue = ghostTarget;
      layerU.uGhost.value = ghostValue;
      flashStart = -1;
      layerU.uGateFlash.value[0] = -1;
      layerU.uGateFlash.value[1] = 0;
    },

    setVisible(on: boolean): void {
      root.visible = on;
    },

    setDebugMode(): void {
      // Props have no debug modes.
    },

    dispose(): void {
      for (let i = 0; i < rings.length; i++) rings[i]!.dispose();
      rings = [];
      for (const g of shipGeos) g.dispose();
      for (const m of shipMats) m.dispose();
      cockpitMat?.dispose();
      cockpitMat = null;
      cockpit = null;
      ctx?.scene.remove(root);
      ctx = null;
      feeder = null;
    },
  };

  if (o.debug) {
    const debug: PropsDebug = {
      ring(id: number) {
        const r = rings[id]!;
        const s = r.store;
        return {
          cap: s.cap, modulus: s.modulus, head: s.head, liveRecords: s.liveRecords, visible: r.mesh.visible,
          instanceCount: r.geometry.instanceCount, filter: s.filter, truncated: s.truncated,
        };
      },
      counts: () => ({ ...counts }),
      density: () => ({ current: density.current, target: density.target, phase: density.phase }),
      pendingRanges: (id: number) => rings[id]!.buffer.updateRanges.length,
      setShipVisible(on: boolean): void {
        shipOn = on;
        if (shipBody) shipBody.visible = on;
        if (shipGlow) shipGlow.visible = on;
      },
      setShipForward(forward: number): void {
        shipForward = forward;
        layerU.uGateOpen.value = forward - SHIP_HALF_LENGTH;
      },
      setOrbFade(on: boolean): void {
        layerU.uOrbFade.value = on ? 1 : 0;
      },
      setDensityWindow(w: number): void {
        layerU.uDensityWindow.value = w;
      },
      setMirrorAllowed(on: boolean): void {
        mirrorAllowed = on;
        // No floor in the tile: no reflection under it, and RING drawn whole rather than cut at a floor line that is not there.
        layerU.uRingCut.value = on ? 1 : 0;
        if (quality) applyMirror(quality);
      },
      buffer: (id: number) => rings[id]!.buffer,
      get feeder() { return feeder; },
    };
    Object.defineProperty(layer, 'debug', { value: debug, enumerable: true });
  }
  return layer;
}
