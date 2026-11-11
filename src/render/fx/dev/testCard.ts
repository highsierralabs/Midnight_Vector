// T06's own test scene, so the post stack has known inputs while the real sky, terrain and props are being written.
// The plan's numbers are comparable only if it is built exactly like this, so tune the stack against it and do not
// polish it. Query: card=scene|flat|hue|surfaces, v, equal, over, alpha, wall, hidden. Never reaches a production bundle.
import {
  BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial,
} from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../../../contracts/glsl';
import { RenderOrder, type RenderContext, type RenderLayer } from '../../../contracts/index';

const STICKS = 400;

const SKY_VERT = `${COMMON_VERT}
out vec3 vRay;
void main() {
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1., 1.);
  vRay = (inverse(viewMatrix) * vec4(v.xyz, 0.)).xyz;
  gl_Position = vec4(position.xy, 0., 1.);
}`;

const SCENE_BODY = `
  vec3 rd = normalize(vRay);
  vec3 c = skyGrad(rd.y); vec4 s = sunDisc(rd, 1.); c = c * (1. - s.a) + s.rgb;
  float d = 7. / max(-rd.y, 1e-4); vec2 uv = rd.xz * d / 8.; uv.y += uTravel.x / 8.;
  float g = pristineGrid(uv, vec2(.03)); float f = fogK(d);
  vec3 fl = mix(mix(uPal[0] * .16, uPal[1] * .2, .3) + emit(uPal[5], 1.45) * g * (1. - .72 * f), skyGrad(0.), f);
  c = rd.y < 0. ? fl : c;
  gl_FragColor = vec4(c * uOver, uAlpha);`;

const FLAT_BODY = `
  gl_FragColor = vec4(vec3(uV), 1.);`;

const SURFACES_BODY = `
  vec3 rd = normalize(vRay);
  vec3 c = rd.y >= 0. ? skyGrad(rd.y) : mix(uPal[0] * .16, uPal[1] * .2, .3);
  gl_FragColor = vec4(c * uOver, uAlpha);`;

function hueBody(a: string, b: string): string {
  return `
  vec2 q = gl_FragCoord.xy; vec3 c = vec3(0.);
  if (abs(q.x - 480.) < 40. && abs(q.y - 540.) < 300.) c = ${a};
  if (abs(q.x - 1440.) < 40. && abs(q.y - 540.) < 300.) c = ${b};
  gl_FragColor = vec4(c, 1.);`;
}

function bodyFor(q: URLSearchParams): string {
  const card = q.get('card') ?? 'scene';
  if (card === 'flat') return FLAT_BODY;
  if (card === 'surfaces') return SURFACES_BODY;
  if (card === 'hue') {
    return q.get('equal') === '1' ? hueBody('uPal[4] * 2.', 'uPal[6] * 2.') : hueBody('emit(uPal[4], 1.4)', 'emit(uPal[6], 1.4)');
  }
  return SCENE_BODY;
}

const STICK_VERT = `${COMMON_VERT}
in vec4 aI;
out float vT;
void main() {
  float w = .08 + .0012 * (-aI.y);
  vec3 p = vec3(aI.x + position.x * w, position.y * aI.z, aI.y);
  vT = aI.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(bendV(p), 1.);
}`;

const STICK_FRAG = `${COMMON_FRAG}
uniform float uOver;
in float vT;
void main() {
  gl_FragColor = vec4(emit(mix(uPal[5], uPal[6], step(.5, vT)), mix(1.4, 2.4, fract(vT * 7.))) * uOver, 1.);
}`;

const QUAD = new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0]);

/** Lehmer seed 1: side alternating, x, z, height and colour seed, in this order. */
function stickSeeds(): Float32Array {
  const inst = new Float32Array(STICKS * 4);
  let s = 1;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < STICKS; i++) {
    const side = i % 2 ? 1 : -1;
    inst[i * 4] = side * (30 + rnd() * 260);
    inst[i * 4 + 1] = -(20 + rnd() * 1800);
    inst[i * 4 + 2] = 4 + rnd() * 60;
    inst[i * 4 + 3] = rnd();
  }
  return inst;
}

export interface TestCard extends RenderLayer {
  /** Shows the mesh that stayed hidden through precompile. */
  showHidden(): void;
}

export function createTestCard(q: URLSearchParams): TestCard {
  const meshes: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  let hidden: Mesh | null = null;
  let hiddenShown = false;
  let hideWithCard: (on: boolean) => void = () => undefined;

  function add(geometry: BufferGeometry, material: ShaderMaterial, order: number): Mesh {
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = order;
    meshes.push(m);
    disposables.push(geometry, material);
    return m;
  }

  return {
    name: 'sky',
    attach(ctx: RenderContext): void {
      const uOver = { value: Number(q.get('over') ?? 1) };
      const uAlpha = { value: Number(q.get('alpha') ?? 1) };
      const uV = { value: Number(q.get('v') ?? 0.2) };
      const scene = (q.get('card') ?? 'scene') === 'scene';

      const tri = new BufferGeometry();
      tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      add(tri, new ShaderMaterial({
        uniforms: { ...ctx.shared, uOver, uAlpha, uV },
        vertexShader: SKY_VERT,
        fragmentShader: `${COMMON_FRAG}
uniform float uOver; uniform float uAlpha; uniform float uV;
in vec3 vRay;
void main() {${bodyFor(q)}
}`,
        depthTest: false,
        depthWrite: false,
      }), RenderOrder.SKY);

      const quad = new InstancedBufferGeometry();
      quad.setAttribute('position', new BufferAttribute(QUAD, 3));
      quad.setAttribute('aI', new InstancedBufferAttribute(stickSeeds(), 4));
      quad.instanceCount = STICKS;
      const sticks = add(quad, new ShaderMaterial({
        uniforms: { ...ctx.shared, uOver },
        vertexShader: STICK_VERT,
        fragmentShader: STICK_FRAG,
      }), RenderOrder.PROP);
      sticks.visible = scene;
      hideWithCard = (on) => { sticks.visible = on && scene; };

      if (q.get('wall') === '1') {
        const wall = new BufferGeometry();
        wall.setAttribute('position', new BufferAttribute(new Float32Array([-40, -13, -6, 0, -13, -6, 0, 27, -6, -40, -13, -6, 0, 27, -6, -40, 27, -6]), 3));
        add(wall, new ShaderMaterial({
          uniforms: { ...ctx.shared },
          vertexShader: `${COMMON_VERT}
void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
          fragmentShader: 'void main() { gl_FragColor = vec4(.01, .01, .012, 1.); }',
          side: DoubleSide,
        }), RenderOrder.PROP);
      }

      if (q.get('hidden') === '1') {
        const plane = new BufferGeometry();
        plane.setAttribute('position', new BufferAttribute(new Float32Array([-2, 5, -20, 2, 5, -20, 2, 9, -20, -2, 5, -20, 2, 9, -20, -2, 9, -20]), 3));
        hidden = add(plane, new ShaderMaterial({
          uniforms: { ...ctx.shared },
          vertexShader: `${COMMON_VERT}
void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
          fragmentShader: `${COMMON_FRAG}
void main() { gl_FragColor = vec4(emit(uPal[6], .5), 1.); }`,
          side: DoubleSide,
        }), RenderOrder.PROP);
        hidden.visible = false;
      }

      for (const m of meshes) ctx.scene.add(m);
    },
    setQuality(): void {
      // The card is a fixed input and has nothing to shed.
    },
    frame(): void {
      // Everything it reads is a shared uniform.
    },
    rebuild(): void {
      // No uniform or attribute here depends on a warp, and attributes re-upload by themselves after a restore.
    },
    setVisible(on: boolean): void {
      for (const m of meshes) m.visible = on;
      // setVisible hides. Turning back on must not bring out what this query or precompile keeps hidden.
      hideWithCard(on);
      if (hidden) hidden.visible = on && hiddenShown;
    },
    setDebugMode(): void {
      // No debug materials here.
    },
    dispose(): void {
      for (const m of meshes) m.removeFromParent();
      for (const d of disposables) d.dispose();
    },
    showHidden(): void {
      hiddenShown = true;
      if (hidden) hidden.visible = true;
    },
  };
}
