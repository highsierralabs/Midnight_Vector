// Dev only. A bent translucent floor, fogged into skyGrad, with a plain sun column, so the sky's join and its leak through
// the floor can be judged. It carries section 6.4's alpha law for that reason. Not a stub of T03, and never imported by shipped code.
import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { COMMON_VERT } from '../../../contracts/glsl';
import { RenderOrder, type RenderContext, type RenderLayer } from '../../../contracts/index';
import { commonFragWith } from '../skyMaterial';

const VERT = `
out vec3 vP;
void main() {
  vec3 p = bendV(position);
  vP = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
`;

const FRAG = `
in vec3 vP;
void main() {
  vec3 v = vP - vec3(cameraPosition.xy, 0.);
  float d = length(v);
  vec3 rd = v / d;
  float fog = fogK(d);
  vec2 uv = vec2(vP.x, -vP.z) / 8.;
  float gr = pristineGrid(uv, vec2(.03));
  vec3 c = uPal[0] * .16 + emit(uPal[5], 1.45 * (1. - .72 * fogK(d * 1.4))) * gr * .55;
  float co = max(-rd.y, 0.);
  float F = .05 + .95 * pow(1. - co, 5.);
  vec3 rr = normalize(vec3(rd.x, -rd.y, rd.z));
  vec4 s = sunDisc(rr, .55);
  c += s.rgb * F * .85 * smoothstep(-.34, -.05, rd.y);
  c = mix(c, skyGrad(rd.y), fog);
  float al = mix(mix(.72, .94, 1. - F), 1., fog);
  gl_FragColor = vec4(c, al);
}
`;

export function createDevFloor(heroSource?: string): RenderLayer {
  let ctx: RenderContext | null = null;
  let mesh: Mesh<PlaneGeometry, ShaderMaterial> | null = null;
  return {
    name: 'terrain',
    attach(c: RenderContext): void {
      ctx = c;
      const geometry = new PlaneGeometry(8192, 6400, 1, 320);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0, -3136);   // z from 64 to -6336
      const material = new ShaderMaterial({
        uniforms: { ...c.shared },
        vertexShader: COMMON_VERT + VERT,
        fragmentShader: commonFragWith(heroSource) + FRAG,
        transparent: true,
      });
      mesh = new Mesh(geometry, material);
      mesh.renderOrder = RenderOrder.TERRAIN;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      c.scene.add(mesh);
    },
    setQuality(): void { /* no quality concerns this stand-in */ },
    frame(): void { /* everything it reads is shared */ },
    rebuild(): void { /* nothing to refill */ },
    setVisible(on: boolean): void {
      if (mesh) mesh.visible = on;
    },
    setDebugMode(): void { /* no debug mode concerns this stand-in */ },
    dispose(): void {
      if (ctx && mesh) {
        ctx.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      ctx = null;
      mesh = null;
    },
  };
}
