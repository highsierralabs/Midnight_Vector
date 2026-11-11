// D-006: instanced attribute bytes over section 9.3's 0.2 MB. T09's B18 audit reads 486,672 B on the app, against
// T05's planned 3241 instances at 48 B, 152 KB. This regression counts the same bytes T09's audit counts (instanced
// attributes, deduplicated), grouped by the scene's top-level child (one per layer) and by mesh name, so the owner is
// named by the data, and asserts the ceiling.
import { expect, test } from '../../support/pw';
import { openApp } from '../lib/app';

const CEILING = 0.2 * 1024 * 1024;

test('D-006: instanced attribute bytes are within section 9.3, by layer', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'gpu only');
  await openApp(page, '&tier=3');
  const r = await page.evaluate(() => {
    type Attr = { array?: ArrayLike<number> & { byteLength?: number }; data?: { array?: { byteLength: number }; isInstancedInterleavedBuffer?: boolean }; isInterleavedBufferAttribute?: boolean; isInstancedBufferAttribute?: boolean };
    const scene = window.__mvE2e!.host.ctx.scene;
    const seen = new Set<unknown>();
    const byTop: Record<string, number> = {};
    const byMesh: Record<string, { bytes: number; count: number }> = {};
    let total = 0;
    const bytesOf = (a: Attr): number => (a.isInterleavedBufferAttribute ? a.data?.array?.byteLength ?? 0 : a.array?.byteLength ?? 0);
    const instanced = (a: Attr): boolean => (a.isInterleavedBufferAttribute ? a.data?.isInstancedInterleavedBuffer === true : a.isInstancedBufferAttribute === true);
    for (const top of scene.children) {
      const label = `${top.name || top.type}#${scene.children.indexOf(top)}`;
      top.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; name: string; geometry: { attributes: Record<string, Attr> }; instanceMatrix?: Attr; instanceColor?: Attr | null; count?: number };
        if (!m.isMesh) return;
        const list: [Attr, boolean][] = Object.values(m.geometry.attributes).map((a) => [a, false]);
        if (m.instanceMatrix) list.push([m.instanceMatrix, true]);
        if (m.instanceColor) list.push([m.instanceColor, true]);
        for (const [a, forced] of list) {
          if (seen.has(a) || !(forced || instanced(a))) continue;
          seen.add(a);
          const b = bytesOf(a);
          total += b;
          byTop[label] = (byTop[label] ?? 0) + b;
          const key = `${label} / ${m.name || 'mesh'}`;
          const e = (byMesh[key] ??= { bytes: 0, count: 0 });
          e.bytes += b;
          e.count += 1;
        }
      });
    }
    const top = Object.entries(byMesh).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15);
    return { total, byTop, top };
  });
  console.log(`D-006 instanced bytes ${r.total} (${(r.total / 1024).toFixed(1)} KB) against ${CEILING}`);
  console.log(`D-006 by layer ${JSON.stringify(r.byTop)}`);
  for (const [k, v] of r.top) console.log(`D-006 mesh ${k}: ${v.bytes} B in ${v.count} attributes`);
  expect(r.total).toBeLessThanOrEqual(CEILING);
});
