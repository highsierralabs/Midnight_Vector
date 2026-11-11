// A dev-only stand-in for T03 and T04, made only of contract GLSL, so the mirror, bloom and silhouettes have something to sit
// against. It is not their look. A fullscreen sky (skyGrad, sunDisc) and a floor with T03's alpha formula inside abs(x) < 85.
import { BufferAttribute, BufferGeometry, Group, Mesh, ShaderMaterial, type IUniform } from 'three';
import { RenderOrder, type LayerName, type QualityProfile, type RenderContext, type RenderLayer } from '../../../contracts/index';
import { COMMON_FRAG, COMMON_VERT } from '../../../contracts/glsl';
import type { BackdropControls } from './types';

const SKY_VERT = `${COMMON_VERT}
out vec3 vDir;
void main() {
  // The view ray in world axes, so sunDisc sees the same gnomonic plane the sky does in T04.
  vec3 ray = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.);
  vDir = transpose(mat3(viewMatrix)) * ray;
  gl_Position = vec4(position.xy, 1., 1.);
}`;
const SKY_FRAG = `${COMMON_FRAG}
in vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 c = skyGrad(rd.y);
  vec4 s = sunDisc(rd, 1.);
  c = c * (1. - s.a) + s.rgb;
  gl_FragColor = vec4(c, 1.);
}`;

const FLOOR_VERT = `${COMMON_VERT}
uniform float uHills;
out vec3 vRel; out vec2 vGround; out float vRise;
void main() {
  // position.x is lateral, position.z is forward distance. The fake world's hills, so grounded props sit on something.
  float x = position.x, fwd = position.z;
  float dx = abs(x);
  float k = smoothstep(85., 515., dx);
  float zw = fwd + uTravel.y;
  float h = k * (135. + 250. * smoothstep(260., 1360., dx))
    * (.5 + .2 * sin(TAU * x / 1024.) * sin(TAU * zw / 2048.) + .08 * sin(TAU * x / 256.) * sin(TAU * zw / 512.));
  vec3 p = bendV(vec3(x, h * uHills, -fwd));
  vRise = smoothstep(0., 12., h * uHills);
  vGround = vec2(x, fwd);
  vRel = p - vec3(cameraPosition.xy, 0.);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FLOOR_FRAG = `${COMMON_FRAG}
in vec3 vRel; in vec2 vGround; in float vRise;
uniform float uMirrorOn;
void main() {
  vec2 uv = vec2(vGround.x / 8., (vGround.y + uTravel.x) / 8.);
  float grid = pristineGrid(uv, vec2(.02));
  float d = length(vRel);
  vec3 rd = vRel / max(d, 1e-3);
  float fog = fogK(d);
  float F = .05 + .95 * pow(1. - max(-rd.y, 0.), 5.);
  // T03's formula: mix(mix(.72, .94, 1 - F), 1, rise), then toward 1 with fog. Alpha 1 everywhere with the mirror off.
  float alpha = mix(mix(.72, .94, 1. - F), 1., vRise);
  alpha = mix(alpha, 1., fog);
  if (uMirrorOn < .5) alpha = 1.;
  vec3 c = uPal[0] * .6 + emit(uPal[5], 1.1 * (1. - .7 * fogK(d * 1.4))) * grid * (1. - .55 * vRise);
  c = mix(c, skyGrad(rd.y), fog);
  gl_FragColor = vec4(c, alpha);
}`;

function fullscreenGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

/** A static lattice in render space, with denser rows and columns near the camera. No stock geometry. */
function floorGeometry(): BufferGeometry {
  const cols = 96;
  const rows = 96;
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3);
  const index = new Uint32Array(cols * rows * 6);
  let p = 0;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const fwd = -40 + 6200 * t * t;
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1;
      pos[p++] = Math.sign(u) * 4800 * u * u;
      pos[p++] = 0;
      pos[p++] = fwd;
    }
  }
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index[k++] = a;
      index[k++] = b;
      index[k++] = c;
      index[k++] = b;
      index[k++] = d;
      index[k++] = c;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

export function createBackdrop(): RenderLayer & BackdropControls {
  const root = new Group();
  root.name = 'backdrop';
  let ctx: RenderContext | null = null;
  let sky: Mesh | null = null;
  let floor: Mesh | null = null;
  const uMirrorOn = { value: 1 };
  const uHills = { value: 1 };
  return {
    name: 'sky' as LayerName,
    attach(c: RenderContext): void {
      ctx = c;
      const shared = c.shared as unknown as Record<string, IUniform>;
      const skyMat = new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { ...shared }, depthTest: false, depthWrite: false });
      sky = new Mesh(fullscreenGeometry(), skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = RenderOrder.SKY;
      const floorMat = new ShaderMaterial({
        vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, uniforms: { ...shared, uMirrorOn, uHills }, transparent: true, depthWrite: true, depthTest: true,
      });
      floor = new Mesh(floorGeometry(), floorMat);
      floor.frustumCulled = false;
      floor.renderOrder = RenderOrder.TERRAIN;
      root.add(sky, floor);
      c.scene.add(root);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      uMirrorOn.value = q.mirror ? 1 : 0;
    },
    frame(): void { /* nothing streams */ },
    rebuild(): void { /* nothing to refill */ },
    setVisible(on: boolean): void { root.visible = on; },
    setDebugMode(): void { /* none */ },
    setFloor(on: boolean): void { if (floor) floor.visible = on; },
    setSky(on: boolean): void { if (sky) sky.visible = on; },
    dispose(): void {
      sky?.geometry.dispose();
      floor?.geometry.dispose();
      (sky?.material as ShaderMaterial | undefined)?.dispose();
      (floor?.material as ShaderMaterial | undefined)?.dispose();
      ctx?.scene.remove(root);
    },
  };
}
