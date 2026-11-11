import {
  BufferAttribute, BufferGeometry, DataTexture, Group, InstancedBufferAttribute, InstancedMesh, Mesh, Object3D, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType,
} from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_LIMIT, ZONE_CHUNKS, type WorldSource, type ZoneState } from '../../../src/contracts/index';
import { auditScene, finiteReport, findBiomeChunk, nonFlat } from '../../../src/harness/audit';
import { createFakeHost } from '../../../src/testing/fakeHost';
import { createFakeWorld } from '../../../src/testing/fakeWorld';

function geometry(vertices: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  return g;
}

describe('auditScene', () => {
  it('counts objects, meshes and the bytes of each distinct attribute once', () => {
    const scene = new Scene();
    const g = geometry(10);
    const group = new Group();
    group.add(new Mesh(g, new ShaderMaterial()), new Mesh(g, new ShaderMaterial()));
    scene.add(group);
    const a = auditScene(scene);
    expect(a.objects).toBe(4);
    expect(a.meshes).toBe(2);
    expect(a.attributeBytes).toBe(10 * 12);
    expect(a.instanceBytes).toBe(0);
  });

  it('counts an index and an instanced attribute', () => {
    const scene = new Scene();
    const g = geometry(4);
    g.setIndex(new BufferAttribute(new Uint32Array(6), 1));
    g.setAttribute('aRow', new InstancedBufferAttribute(new Float32Array(100), 1));
    scene.add(new Mesh(g, new ShaderMaterial()));
    const a = auditScene(scene);
    expect(a.attributeBytes).toBe(4 * 12 + 6 * 4 + 400);
    expect(a.instanceBytes).toBe(400);
  });

  it('counts an InstancedMesh instance matrix as instance bytes', () => {
    const scene = new Scene();
    scene.add(new InstancedMesh(geometry(3), new ShaderMaterial(), 5));
    const a = auditScene(scene);
    expect(a.instanceBytes).toBe(5 * 16 * 4);
    expect(a.attributeBytes).toBe(3 * 12 + 5 * 16 * 4);
  });

  it('counts a data texture in a uniform once, and ignores other uniforms', () => {
    const tex = new DataTexture(new Uint8Array(8 * 4 * 4), 8, 4, RGBAFormat, UnsignedByteType);
    const scene = new Scene();
    const uniforms = { uAtlas: { value: tex }, uOther: { value: 3 }, uNull: { value: null } };
    scene.add(new Mesh(geometry(1), new ShaderMaterial({ uniforms })), new Mesh(geometry(1), new ShaderMaterial({ uniforms })));
    expect(auditScene(scene).dataTextureBytes).toBe(8 * 4 * 4);
  });

  it('splits pending ranges by whether the mesh can be seen, including through a hidden parent', () => {
    const scene = new Scene();
    const shown = geometry(4);
    (shown.getAttribute('position') as BufferAttribute).addUpdateRange(0, 3);
    scene.add(new Mesh(shown, new ShaderMaterial()));
    const hiddenSelf = geometry(4);
    const attr = hiddenSelf.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < 5; i++) attr.addUpdateRange(i, 1);
    const m = new Mesh(hiddenSelf, new ShaderMaterial());
    m.visible = false;
    scene.add(m);
    const parent = new Group();
    parent.visible = false;
    const underHidden = geometry(4);
    const attr2 = underHidden.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < 9; i++) attr2.addUpdateRange(i, 1);
    parent.add(new Mesh(underHidden, new ShaderMaterial()));
    scene.add(parent);
    const a = auditScene(scene);
    expect(a.pendingVisible).toBe(1);
    expect(a.pendingHiddenMax).toBe(9);
  });

  it('counts pending texture rows too', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1);
    tex.addUpdateRange(0, 4);
    const scene = new Scene();
    scene.add(new Mesh(geometry(1), new ShaderMaterial({ uniforms: { uAtlas: { value: tex } } })));
    expect(auditScene(scene).pendingVisible).toBe(1);
  });

  it('an empty scene reads one object and nothing else', () => {
    expect(auditScene(new Object3D())).toEqual({
      objects: 1, meshes: 0, attributeBytes: 0, instanceBytes: 0, dataTextureBytes: 0, pendingVisible: 0, pendingHiddenMax: 0,
    });
  });
});

describe('finiteReport', () => {
  it('passes a clean host', () => {
    expect(finiteReport(createFakeHost())).toEqual({ ok: true, bad: [] });
  });

  it('names a bad sim number', () => {
    const host = createFakeHost();
    (host.sim.state as { speed: number }).speed = Number.NaN;
    const r = finiteReport(host);
    expect(r.ok).toBe(false);
    expect(r.bad).toEqual(['sim.speed=NaN']);
  });

  it('names bad travel', () => {
    const host = createFakeHost();
    (host.sim.state.travel as { local: number }).local = Number.POSITIVE_INFINITY;
    expect(finiteReport(host).bad).toEqual(['sim.travel=1,Infinity']);
  });

  it('names a bad shared uniform, array or scalar', () => {
    const host = createFakeHost();
    host.ctx.shared.uTravel.value[1] = Number.NaN;
    host.ctx.shared.uCamRow.value = Number.NaN;
    expect(finiteReport(host).bad.sort()).toEqual(['uCamRow=NaN', 'uTravel[1]=NaN']);
  });

  it('names a bad camera matrix', () => {
    const host = createFakeHost();
    host.ctx.camera.matrixWorld.elements[12] = Number.NaN;
    expect(finiteReport(host).bad).toEqual(['camera.matrixWorld[12]=NaN']);
  });
});

describe('nonFlat', () => {
  it('reads real relief on the fake hills', () => {
    const r = nonFlat(createFakeWorld(), 5);
    expect(r.std).toBeGreaterThan(1);
    expect(r.meanStep).toBeGreaterThan(0);
  });

  it('reads 0 on a flat world, so a dead noise cannot pass', () => {
    const flat: WorldSource = { ...createFakeWorld(), height: () => 0 };
    expect(nonFlat(flat, 5)).toEqual({ std: 0, meanStep: 0 });
  });

  it('reads 0 on a world that only has a constant height', () => {
    const r = nonFlat({ ...createFakeWorld(), height: () => 42 }, 5);
    expect(r.std).toBeLessThan(1e-6);
    expect(r.meanStep).toBe(0);
  });

  it('asks whole rows beside the valley', () => {
    const calls: [number, number, number, number][] = [];
    const spy: WorldSource = {
      ...createFakeWorld(),
      height: (x, iz, zs, z) => {
        calls.push([x, iz, zs, z]);
        return 0;
      },
    };
    nonFlat(spy, 100);
    expect(Math.min(...calls.map((c) => c[0]))).toBeGreaterThan(85);
    expect(new Set(calls.map((c) => c[1]))).toEqual(new Set([100, 101, 102, 103, 104, 105, 106, 107]));
    expect(new Set(calls.map((c) => c[2]))).toEqual(new Set([64]));
  });
});

describe('findBiomeChunk', () => {
  it('finds a chunk five in, on the fake world where zone index is the biome', () => {
    const c = findBiomeChunk(createFakeWorld(), 3, 0);
    expect(c).toBe(3 * ZONE_CHUNKS + 5);
  });

  it('starts at the first zone at or after fromChunk', () => {
    expect(findBiomeChunk(createFakeWorld(), 3, 305)).toBe(9 * ZONE_CHUNKS + 5);
    expect(findBiomeChunk(createFakeWorld(), 3, 300)).toBe(3 * ZONE_CHUNKS + 5);
  });

  it('works from very far away', () => {
    const from = 15625000000000;
    const c = findBiomeChunk(createFakeWorld(), 2, from);
    expect(c).toBeGreaterThanOrEqual(from);
    expect(c % ZONE_CHUNKS).toBe(5);
  });

  it('skips a zone that is mid-crossfade', () => {
    const base = createFakeWorld();
    const world: WorldSource = {
      ...base,
      zoneAt(at, out: ZoneState): ZoneState {
        base.zoneAt(at, out);
        out.biomeA = 3;
        out.biomeMix = at.chunk < 500 ? 0.5 : 0;
        return out;
      },
    };
    expect(findBiomeChunk(world, 3, 0)).toBe(505);
  });

  it('reads -1 when no zone has it, and never passes the warp limit', () => {
    expect(findBiomeChunk(createFakeWorld(), 99, 0)).toBe(-1);
    expect(findBiomeChunk(createFakeWorld(), 0, CHUNK_LIMIT)).toBe(-1);
  });
});
