// The fx layer: speed lines that streak toward the vanishing point. Their motion derives from uTravel.y, so nothing
// accumulates and they stay continuous at any distance. Tier sets the true instance count; feel fades lines by rank.
import {
  AdditiveBlending, BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2,
} from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../../contracts/glsl';
import { RenderOrder, type FrameView, type QualityProfile, type RenderContext, type RenderLayer } from '../../contracts/index';
import { LINE_CAPACITY, LINE_FLOATS, LINE_PERIOD, lineLength, writeLineSeeds } from './speedLineParams';
import fragmentSource from './speedLines.frag.glsl?raw';
import vertexSource from './speedLines.vert.glsl?raw';

export interface SpeedLinesOptions {
  /** The wrap test's negative control: a period that does not divide 4096. Nothing else reads it. */
  linePeriod?: number;
}

const VERTS_PER_LINE = new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0]);

export function createSpeedLinesLayer(o: SpeedLinesOptions = {}): RenderLayer {
  const uLineK = { value: 0 };
  const uLineLen = { value: lineLength(0) };
  const uLineCam = { value: new Vector2() };

  let geometry: InstancedBufferGeometry | null = null;
  let material: ShaderMaterial | null = null;
  let mesh: Mesh | null = null;
  let count = 0;
  let shown = true;

  return {
    name: 'fx',
    attach(ctx: RenderContext): void {
      geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(VERTS_PER_LINE, 3));
      const seeds = new Float32Array(LINE_CAPACITY * LINE_FLOATS);
      writeLineSeeds(seeds);
      geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, LINE_FLOATS));
      geometry.instanceCount = 0;
      const vertex = o.linePeriod === undefined
        ? vertexSource
        : vertexSource.replace(`#define LINE_PERIOD ${LINE_PERIOD}.`, `#define LINE_PERIOD ${o.linePeriod}.`);
      material = new ShaderMaterial({
        uniforms: { ...ctx.shared, uLineK, uLineLen, uLineCam },
        vertexShader: COMMON_VERT + vertex,
        fragmentShader: COMMON_FRAG + fragmentSource,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // cross(dir, v) gives a winding that depends on the line, so FrontSide would cull some.
        side: DoubleSide,
      });
      mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = RenderOrder.SPEED_LINES;
      ctx.scene.add(mesh);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      count = q.speedLines;
      if (geometry) geometry.instanceCount = count;
    },
    frame(v: Readonly<FrameView>): void {
      const k = v.feel.speedLines;
      uLineK.value = k;
      uLineLen.value = lineLength(v.sim.speed);
      uLineCam.value.set(v.camX, v.camY);
      if (mesh) mesh.visible = shown && k > 0 && count > 0;
    },
    rebuild(): void {
      // No uniform is world-absolute, and the attribute re-uploads by itself after a restore.
    },
    setVisible(on: boolean): void {
      shown = on;
      if (!on && mesh) mesh.visible = false;
    },
    setDebugMode(): void {
      // No debug materials here.
    },
    dispose(): void {
      mesh?.removeFromParent();
      geometry?.dispose();
      material?.dispose();
      mesh = null;
      geometry = null;
      material = null;
    },
  };
}
