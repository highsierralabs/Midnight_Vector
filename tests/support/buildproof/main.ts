// Proves the toolchain bundles three, postprocessing and the contract GLSL, and that the bundle runs. npm run build
// cannot run before T10 owns index.html, so this has its own entry.
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  BufferAttribute, BufferGeometry, HalfFloatType, Mesh, PerspectiveCamera, REVISION, Scene, ShaderMaterial, WebGLRenderer,
} from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../../../src/contracts/glsl';

const out = document.getElementById('out');
const renderer = new WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
renderer.setSize(320, 180);
document.body.append(renderer.domElement);

const geometry = new BufferGeometry();
geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const material = new ShaderMaterial({
  vertexShader: `${COMMON_VERT}\nvoid main() { gl_Position = vec4(position.xy, 1., 1.); }`,
  fragmentShader: `${COMMON_FRAG}\nvoid main() { gl_FragColor = vec4(skyGrad(.1), 1.); }`,
  uniforms: {
    uTravel: { value: new Float32Array(2) },
    uCamRow: { value: 0 },
    uPhases: { value: new Float32Array(8) },
    uBend: { value: new Float32Array([0, 0, 1500]) },
    uPal: { value: new Float32Array(21).fill(0.5) },
    uFog: { value: new Float32Array([1500, 4300]) },
    uHero: { value: new Float32Array(3) },
  },
  depthTest: false,
  depthWrite: false,
});
const mesh = new Mesh(geometry, material);
mesh.frustumCulled = false;
const scene = new Scene();
scene.add(mesh);
const camera = new PerspectiveCamera(58, 16 / 9, 1, 6200);

const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 2 });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, new BloomEffect({ mipmapBlur: true, levels: 4 }), new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })));
composer.render(0);

if (out) out.textContent = `build proof ok: three r${REVISION}, common ${COMMON_FRAG.length} chars`;
