// A9b, D-006 (plans/T10-integrate.md section 10): section 9.3's 0.2 MB of instance attributes, counted the way T09's scene audit
// counts them (src/harness/audit.ts): each distinct attribute object once, and an interleaved view charged its whole buffer. A buffer
// seen through three views is therefore counted three times, although three uploads it once, because WebGLAttributes.js keys an
// interleaved view by its data [O: three 0.187.0, WebGLAttributes.js:183]. So the layer must give the audit exactly one attribute
// object per GL buffer: then the audit's count and the GL buffers' bytes agree, and both are 48 B per instance.
import { InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh, PerspectiveCamera, Scene, type BufferAttribute, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { RenderContext } from '../../../src/contracts/index';
import { createSharedUniforms } from '../../../src/core/uniforms';
import { createPropsLayer } from '../../../src/render/props/layer';
import { RING_PLAN } from '../../../src/render/props/plan';
import { INST_STRIDE } from '../../../src/render/props/ring';
import { createFakeWorld } from '../../../src/testing/fakeWorld';

const CEILING = 0.2 * 1024 * 1024;
const INSTANCES = RING_PLAN.reduce((s, p) => s + p.cap, 0);

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

function isInterleaved(a: AnyAttribute): a is InterleavedBufferAttribute {
  return 'isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute;
}

function isInstanced(a: AnyAttribute): boolean {
  if (isInterleaved(a)) return 'isInstancedInterleavedBuffer' in a.data && a.data.isInstancedInterleavedBuffer === true;
  return 'isInstancedBufferAttribute' in a && a.isInstancedBufferAttribute === true;
}

/** audit: T09's rule. gl: what three allocates, one buffer per distinct storage (an interleaved view's data, else the attribute). */
function instanceBytes(root: Object3D): { audit: number; gl: number; attributes: number; buffers: number } {
  const seen = new Set<unknown>();
  const storage = new Set<unknown>();
  const out = { audit: 0, gl: 0, attributes: 0, buffers: 0 };
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const a of Object.values(o.geometry.attributes) as AnyAttribute[]) {
      if (!isInstanced(a)) continue;
      const bytes = isInterleaved(a) ? a.data.array.byteLength : a.array.byteLength;
      if (!seen.has(a)) {
        seen.add(a);
        out.audit += bytes;
        out.attributes++;
      }
      const key: unknown = isInterleaved(a) ? a.data : a;
      if (!storage.has(key)) {
        storage.add(key);
        out.gl += bytes;
        out.buffers++;
      }
    }
  });
  return out;
}

function attachedLayer(): Scene {
  const scene = new Scene();
  const layer = createPropsLayer();
  // attach reads only world, shared and scene; no GL is touched until a render.
  const ctx = { renderer: null, scene, camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld() } as unknown as RenderContext;
  layer.attach(ctx);
  return scene;
}

describe('A9b instance attribute bytes (D-006)', () => {
  it('counts each GL buffer once, at 48 B per instance, within section 9.3', () => {
    const r = instanceBytes(attachedLayer());
    console.log(`A9b instances ${INSTANCES}: audit ${r.audit} B in ${r.attributes} attributes, GL ${r.gl} B in ${r.buffers} buffers, ceiling ${CEILING}`);
    expect(r.gl).toBe(INSTANCES * INST_STRIDE * 4);
    expect(r.audit).toBe(r.gl);
    expect(r.buffers).toBe(RING_PLAN.length);
    expect(r.audit).toBeLessThanOrEqual(CEILING);
  });

  it('negative control: three interleaved views of one buffer, and a second geometry viewing it, are counted 3 and 6 times', () => {
    // The layout before D-006's fix, for one ring with a beam: aInstA, aInstB and aInstC over one buffer, on two geometries.
    const cap = 98;
    const buffer = new InstancedInterleavedBuffer(new Float32Array(cap * INST_STRIDE), INST_STRIDE, 1);
    const root = new Scene();
    for (let g = 0; g < 2; g++) {
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('aInstA', new InterleavedBufferAttribute(buffer, 4, 0));
      geo.setAttribute('aInstB', new InterleavedBufferAttribute(buffer, 4, 4));
      geo.setAttribute('aInstC', new InterleavedBufferAttribute(buffer, 4, 8));
      root.add(new Mesh(geo));
    }
    const r = instanceBytes(root);
    console.log(`A9b control: audit ${r.audit} B in ${r.attributes} attributes, GL ${r.gl} B in ${r.buffers} buffer`);
    expect(r.gl).toBe(cap * INST_STRIDE * 4);
    expect(r.audit).toBe(6 * r.gl);
  });
});
