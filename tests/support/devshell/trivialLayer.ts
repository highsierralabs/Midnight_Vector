// The proof layer, built only from contract GLSL, and not a stub of T03 or T04: it exists to prove the shell, and
// T09's shell target loads it (S-55). Query flags: ?depth=1 adds two quads that test the depth buffer, ?bad=1 breaks
// the fragment shader, ?alpha=1 makes the floor write alpha .25, which only a final alpha-1 write can hide, and ?hot=1
// with ?depth=1 makes the near quad far above the bloom threshold, so a test can look for light outside it. It records
// its lifecycle calls on window.__layerLog, and each frame on window.__frames and window.__lastView.
import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, type IUniform,
} from 'three';
import { RenderOrder, type FrameView, type RenderContext, type RenderLayer, type SharedUniforms } from '../../../src/contracts/index';
import { COMMON_FRAG, COMMON_VERT } from '../../../src/contracts/glsl';

declare global {
  interface Window {
    __layerLog?: string[];
    /** How many times frame ran. The log cannot count, since a run of frames logs once. */
    __frames?: number;
    /** The shell's one FrameView, mutated in place, so this is a live reference. */
    __lastView?: Readonly<FrameView>;
  }
}

function uniformsOf(shared: SharedUniforms): Record<string, IUniform> {
  return { ...shared };
}

const SKY_VERT = `${COMMON_VERT}
out vec3 vRd;
void main() {
  vec3 rdView = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.);
  vRd = transpose(mat3(viewMatrix)) * rdView;
  gl_Position = vec4(position.xy, 1., 1.);
}`;

const SKY_FRAG = `${COMMON_FRAG}
in vec3 vRd;
void main() {
  vec3 rd = normalize(vRd);
  vec3 c = skyGrad(rd.y);
  vec4 s = sunDisc(vRd, 1.);
  gl_FragColor = vec4(c * (1. - s.a) + s.rgb, 1.);
}`;

const FLOOR_VERT = `${COMMON_VERT}
out vec2 vGrid;
out vec3 vRel;
void main() {
  float forward = -position.z;
  vGrid = vec2(position.x, forward + uTravel.x) / 8.;
  vec3 p = bendV(position);
  vRel = p - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;

const floorFrag = (alpha: string): string => `${COMMON_FRAG}
in vec2 vGrid;
in vec3 vRel;
void main() {
  float line = pristineGrid(vGrid, vec2(.035));
  vec3 base = uPal[0] * .25;
  vec3 c = base + emit(uPal[5], 1.9) * line;
  float d = length(vRel);
  c = mix(c, skyGrad(vRel.y / d), fogK(d));
  gl_FragColor = vec4(c, ${alpha});
}`;

const SOLID_VERT = `${COMMON_VERT}
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(bendV(position), 1.);
}`;

const solidFrag = (c: string): string => `void main() { gl_FragColor = vec4(${c}, 1.); }`;

/** Rows bunch toward the camera, so the bend stays smooth on a plain mesh. */
function floorGeometry(): BufferGeometry {
  const cols = 32;
  const rows = 192;
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const index = new Uint32Array(cols * rows * 6);
  let p = 0;
  for (let r = 0; r <= rows; r++) {
    const f = r / rows;
    const z = -4300 * f * f;
    for (let c = 0; c <= cols; c++) {
      positions[p++] = -4096 + (8192 * c) / cols;
      positions[p++] = 0;
      positions[p++] = z;
    }
  }
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index[i++] = a; index[i++] = b; index[i++] = d;
      index[i++] = b; index[i++] = e; index[i++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

function quadGeometry(z: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-10, 0, z, 10, 0, z, 10, 20, z, -10, 20, z]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A run of frames logs once, so a long run does not grow the log. */
function log(name: string): void {
  const entries = (window.__layerLog ??= []);
  if (name === 'frame' && entries[entries.length - 1] === 'frame') return;
  entries.push(name);
}

export function createTrivialLayer(): RenderLayer {
  const q = new URLSearchParams(location.search);
  const group = new Group();
  const meshes: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];

  function add(geometry: BufferGeometry, material: ShaderMaterial, order: number): void {
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = order;
    group.add(m);
    meshes.push(m);
    disposables.push(geometry, material);
  }

  return {
    name: 'sky',
    attach(ctx: RenderContext): void {
      log('attach');
      const uniforms = uniformsOf(ctx.shared);

      const skyGeometry = new BufferGeometry();
      skyGeometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      add(skyGeometry, new ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, depthTest: false, depthWrite: false, side: DoubleSide,
      }), RenderOrder.SKY);

      const floor = floorFrag(q.get('alpha') === '1' ? '.25' : '1.');
      const fragment = q.get('bad') === '1' ? `${floor}\nfloat broken() { return thisNameIsNotDeclared; }` : floor;
      add(floorGeometry(), new ShaderMaterial({
        vertexShader: FLOOR_VERT, fragmentShader: fragment, uniforms, side: DoubleSide,
      }), RenderOrder.TERRAIN);

      if (q.get('depth') === '1') {
        add(quadGeometry(-40), new ShaderMaterial({
          vertexShader: SOLID_VERT, fragmentShader: solidFrag(q.get('hot') === '1' ? 'vec3(8.)' : 'vec3(0., 1., 0.)'), uniforms, side: DoubleSide,
        }), RenderOrder.PROP);
        add(quadGeometry(-80), new ShaderMaterial({
          vertexShader: SOLID_VERT, fragmentShader: solidFrag('vec3(1., 0., 0.)'), uniforms, side: DoubleSide,
        }), RenderOrder.PROP + 1);
      }
      ctx.scene.add(group);
    },
    setQuality(): void { log('setQuality'); },
    frame(v: Readonly<FrameView>): void {
      log('frame');
      window.__frames = (window.__frames ?? 0) + 1;
      window.__lastView = v;
    },
    rebuild(): void { log('rebuild'); },
    setVisible(on: boolean): void { group.visible = on; },
    setDebugMode(): void { log('setDebugMode'); },   // this layer has no debug materials
    dispose(): void {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
