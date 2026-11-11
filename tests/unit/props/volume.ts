// Signed volume of a mesh by the divergence theorem: positive when closed and wound outward.
import type { BuiltMesh } from '../../../src/render/props/builders';

export function signedVolume(m: BuiltMesh): number {
  let v = 0;
  const p = m.position;
  for (let i = 0; i < m.index.length; i += 3) {
    const a = m.index[i]! * 3;
    const b = m.index[i + 1]! * 3;
    const c = m.index[i + 2]! * 3;
    const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
    const bx = p[b]!, by = p[b + 1]!, bz = p[b + 2]!;
    const cx = p[c]!, cy = p[c + 1]!, cz = p[c + 2]!;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
