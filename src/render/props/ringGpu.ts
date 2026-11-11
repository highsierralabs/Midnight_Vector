// Wraps a RingStore in instanced geometry and meshes. The store's Float32Array is the buffer's own array, so a write is
// already in place, and only the ranges have to be reported to three.
//
// One attribute object per ring, shared by the ring's main, mirror and beam geometry (D-006). Its 12 floats per instance reach the
// shader as `in mat4 aInst`: three binds an itemSize 12 attribute to a mat4 as four 3-float columns, stride 48 B, at 0, 12, 24 and
// 36 B [O: three 0.187.0, WebGLBindingStates.js, size / locationSize], and GL fills each column's missing w with 1. props.vert.glsl
// reassembles aInstA, aInstB and aInstC from the columns by swizzle, so every value is the same float as before. Three views of one
// interleaved buffer made one GL buffer as well, but section 9.3's scene audit charges each view the whole buffer, so it read
// 485,136 B for 155,568 B on the GPU; one object per buffer makes the two agree (tests/unit/props/bytes.test.ts, A9b).
import { BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, DynamicDrawUsage, type ShaderMaterial } from 'three';
import type { BuiltMesh } from './builders';
import { INST_STRIDE, type RingStore } from './ring';

/** Past this many pending ranges on a hidden mesh, clear them and do one full upload at the next show. */
export const MAX_PENDING_RANGES = 64;

export function meshGeometry(m: BuiltMesh, count: number, buffer: InstancedBufferAttribute): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('aEdge', new BufferAttribute(m.edge, 4));
  g.setAttribute('aUv', new BufferAttribute(m.uv, 2));
  g.setAttribute('aTag', new BufferAttribute(m.tag, 2));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.setAttribute('aInst', buffer);
  g.instanceCount = count;
  // The renderer would otherwise do this on first draw, mid-game. frustumCulled is off, so the value does not matter.
  g.computeBoundingSphere();
  return g;
}

export interface BeamSpec { mesh: BuiltMesh; material: ShaderMaterial; order: number }

export class RingGpu {
  readonly store: RingStore;
  readonly buffer: InstancedBufferAttribute;
  readonly geometry: InstancedBufferGeometry;
  readonly beamGeometry: InstancedBufferGeometry | null;
  readonly mesh: Mesh;
  readonly mirrorMesh: Mesh | null;
  readonly beamMesh: Mesh | null;
  /** A full upload is owed: until it lands, a partial range would suppress it and strand stale slots. */
  private pendingFull = true;
  /** Requested by setQuality. */
  mirrorOn = true;

  constructor(store: RingStore, built: BuiltMesh, normal: ShaderMaterial, order: number, parent: Group, mirror: { material: ShaderMaterial; order: number } | null, beam: BeamSpec | null) {
    this.store = store;
    this.buffer = new InstancedBufferAttribute(store.arr, INST_STRIDE, false, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    this.buffer.onUpload(() => { this.pendingFull = false; });
    this.geometry = meshGeometry(built, store.modulus, this.buffer);
    this.mesh = new Mesh(this.geometry, normal);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    parent.add(this.mesh);
    if (mirror) {
      this.mirrorMesh = new Mesh(this.geometry, mirror.material);
      this.mirrorMesh.frustumCulled = false;
      this.mirrorMesh.renderOrder = mirror.order;
      parent.add(this.mirrorMesh);
    } else {
      this.mirrorMesh = null;
    }
    if (beam) {
      this.beamGeometry = meshGeometry(beam.mesh, store.modulus, this.buffer);
      this.beamMesh = new Mesh(this.beamGeometry, beam.material);
      this.beamMesh.frustumCulled = false;
      this.beamMesh.renderOrder = beam.order;
      parent.add(this.beamMesh);
    } else {
      this.beamGeometry = null;
      this.beamMesh = null;
    }
  }

  /** After any write: hands the store's ranges to three, and sets visibility. Allocates one object per range, at chunk rate. */
  flush(): void {
    const s = this.store;
    const b = this.buffer;
    if (s.fullDirty) {
      s.fullDirty = false;
      s.rangeCount = 0;
      this.requestFull();
    } else if (s.rangeCount > 0) {
      if (!this.pendingFull) {
        for (let i = 0; i < s.rangeCount; i++) b.addUpdateRange(s.rangeStart[i]! * INST_STRIDE, s.rangeLen[i]! * INST_STRIDE);
        b.needsUpdate = true;
        // A hidden mesh never uploads, so its ranges would accumulate without bound.
        if (b.updateRanges.length > MAX_PENDING_RANGES) this.requestFull();
      } else {
        b.needsUpdate = true;
      }
      s.rangeCount = 0;
    }
    this.syncCount();
    this.syncVisible();
  }

  /** One float, for a hidden shard. */
  flushOne(floatIndex: number): void {
    const b = this.buffer;
    if (!this.pendingFull) b.addUpdateRange(floatIndex, 1);
    b.needsUpdate = true;
  }

  requestFull(): void {
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
    this.pendingFull = true;
  }

  syncCount(): void {
    const n = this.store.modulus;
    this.geometry.instanceCount = n;
    if (this.beamGeometry) this.beamGeometry.instanceCount = n;
  }

  syncVisible(): void {
    const on = this.store.liveRecords > 0;
    this.mesh.visible = on;
    if (this.mirrorMesh) this.mirrorMesh.visible = on && this.mirrorOn;
    if (this.beamMesh) this.beamMesh.visible = on;
  }

  dispose(): void {
    this.geometry.dispose();
    this.beamGeometry?.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    (this.mirrorMesh?.material as ShaderMaterial | undefined)?.dispose();
    (this.beamMesh?.material as ShaderMaterial | undefined)?.dispose();
  }
}
