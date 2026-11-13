// T13 A9 and A10, on the integrated build: stills of each camera for looking at, and the readouts measured against the
// dashboard's slots at five stage shapes. Every image path is printed as SCREENSHOT <path>.
import type { Page } from 'playwright/test';
import { COCKPIT_PANELS, COCKPIT_SLOTS, cockpitUnit, type CockpitRect } from '../../src/core/cockpit';
import { decodePng } from '../art/support/png';
import { HIDE_UI_STYLE, nodeWait, openApp } from '../e2e/lib/app';
import { expect, test } from '../support/pw';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const SIZES = [
  { name: '16:9', w: 1920, h: 1080 },
  { name: '21:9', w: 2520, h: 1080 },
  { name: '4:3', w: 1024, h: 768 },
  { name: 'phone landscape', w: 844, h: 390 },
  { name: 'narrow window, upright', w: 390, h: 844 },
] as const;
const CAMS = ['chase', 'cockpit', 'nose'] as const;
/** A readout may sit this far outside its slot, in CSS px: rounding of the unit and of a text box. */
const SLACK = 2;

interface Px { left: number; top: number; right: number; bottom: number }

/** A slot or panel in CSS px of a w x h stage, by the rule both the scene and the styles use. */
function slotPx(r: CockpitRect, w: number, h: number, unit = cockpitUnit(w, h)): Px {
  return { left: w / 2 + r.x0 * unit, right: w / 2 + r.x1 * unit, top: h - r.y1 * unit, bottom: h - r.y0 * unit };
}

async function launchInto(page: Page, cam: number, w: number, h: number): Promise<void> {
  await openApp(page, '&tier=3');
  await page.mouse.click(w / 2, h * 0.5);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  await page.evaluate((m) => { window.__mvE2e!.host.overrideCam?.(m as 0 | 1 | 2); }, cam);
  await expect(page.locator('#mv-ui')).toHaveAttribute('data-cam', CAMS[cam]!);
  await expect(page.locator('#mv-ui')).toHaveAttribute('data-dash', cam === 1 ? '1' : '0');
  // Past the readouts' 200 ms arrival.
  await nodeWait(600);
}

async function rects(page: Page): Promise<Record<string, Px[]>> {
  return page.evaluate(() => {
    const box = (e: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const shown = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
    const inside = (sel: string): { left: number; top: number; right: number; bottom: number }[] => {
      const root = document.querySelector(sel)!;
      const out = [box(root)];
      for (const e of root.querySelectorAll('[data-mv], .mv-label, .mv-pip')) if (shown(e)) out.push(box(e));
      return out;
    };
    return { score: inside('.mv-box-score'), status: inside('.mv-vitals'), nav: inside('.mv-box-dist') };
  });
}

/** What lies outside its slot by more than the slack, as text. The first rect of each list is the box itself. */
function outside(found: Record<string, Px[]>, w: number, h: number, unit?: number): string[] {
  const bad: string[] = [];
  for (const name of ['score', 'status', 'nav'] as const) {
    const slot = slotPx(COCKPIT_SLOTS[name], w, h, unit);
    found[name]!.forEach((r, i) => {
      const over = Math.max(slot.left - r.left, r.right - slot.right, slot.top - r.top, r.bottom - slot.bottom);
      if (over > SLACK) bad.push(`${name}[${i}] is ${over.toFixed(1)} px outside its slot`);
    });
    const box = found[name]![0]!;
    const off = Math.max(Math.abs(box.left - slot.left), Math.abs(box.right - slot.right), Math.abs(box.top - slot.top), Math.abs(box.bottom - slot.bottom));
    if (off > SLACK) bad.push(`${name} box is ${off.toFixed(1)} px off its slot`);
  }
  return bad;
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.w}x${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });

    test('A10: in the cockpit each readout sits on its slot, and the scene drew a panel there', async ({ page }, info) => {
      await launchInto(page, 1, size.w, size.h);
      const found = await rects(page);
      const problems = outside(found, size.w, size.h);
      console.log(`A10 ${size.name}: unit ${cockpitUnit(size.w, size.h).toFixed(2)} px; ${problems.length === 0 ? 'every readout inside its slot' : problems.join('; ')}`);
      expect(problems).toEqual([]);

      const shot = info.outputPath(`cockpit-${size.w}x${size.h}.png`);
      await page.screenshot({ path: shot });
      console.log(`SCREENSHOT ${shot}`);

      // The scene's side of the same rule, read with the readouts hidden: the glass under each slot is dark, and each
      // panel's top and bottom edges are lit lines where the layout says the panel ends.
      await page.addStyleTag({ content: HIDE_UI_STYLE });
      // One exact frame with neutral feel and no ghost blink, so a hit just taken (its flash, and the cockpit's dimmed
      // lines) cannot colour the reading: nobody is steering in this test.
      await page.evaluate(() => {
        const e = window.__mvE2e!;
        window.__mv!.manual(true);
        (e.sim as { ghost: number }).ghost = 0;
        e.host.renderState(e.sim.travel.chunk, e.sim.travel.local, e.sim.tick);
      });
      await nodeWait(200);
      const unit = cockpitUnit(size.w, size.h);
      const png = decodePng(await page.screenshot({ type: 'png' }));
      const sx = png.w / size.w, sy = png.h / size.h;
      const lum = (x: number, y: number): number => {
        const i = (Math.min(png.h - 1, Math.max(0, Math.round(y * sy))) * png.w + Math.min(png.w - 1, Math.max(0, Math.round(x * sx)))) * 4;
        return Math.max(png.rgba[i]!, png.rgba[i + 1]!, png.rgba[i + 2]!);
      };
      for (const [name, slot] of Object.entries(COCKPIT_SLOTS)) {
        const q = slotPx(slot, size.w, size.h);
        const glass = lum((q.left + q.right) / 2, (q.top + q.bottom) / 2);
        console.log(`A10 ${size.name}: glass under ${name} reads ${glass}`);
        expect(glass, `the glass under ${name} is dark`).toBeLessThan(70);
      }
      const reach = Math.max(3, 0.006 * unit);
      for (const [name, panel] of Object.entries(COCKPIT_PANELS)) {
        const q = slotPx(panel, size.w, size.h);
        const x = (q.left + q.right) / 2;
        let top = 0, bottom = 0;
        for (let d = -reach; d <= reach; d++) {
          top = Math.max(top, lum(x, q.top + d));
          bottom = Math.max(bottom, lum(x, q.bottom + d));
        }
        console.log(`A10 ${size.name}: ${name} panel edges lit ${top} (top) and ${bottom} (bottom)`);
        expect(top, `${name} panel: a lit line at its top edge`).toBeGreaterThan(90);
        expect(bottom, `${name} panel: a lit line at its bottom edge`).toBeGreaterThan(90);
      }
    });
  });
}

test.describe('A10 control', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('with a cockpit unit from a reference aspect of 1.5 in the styles only, the readouts leave their slots', async ({ page }) => {
    await launchInto(page, 1, 1024, 768);
    expect(outside(await rects(page), 1024, 768)).toEqual([]);
    await page.evaluate(() => { document.querySelector<HTMLElement>('#mv-ui')!.style.setProperty('--mv-cu', `${1024 / 1.5}px`); });
    const problems = outside(await rects(page), 1024, 768);
    console.log(`A10 control: ${problems.length} readouts off their slots, first: ${problems[0] ?? 'none'}`);
    expect(problems.length).toBeGreaterThan(0);
  });
});

test.describe('A9: stills', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('each camera in three biomes, and HIDE HUD in the cockpit', async ({ page }, info) => {
    test.setTimeout(240_000);
    await openApp(page, '&tier=3&period=0');
    await page.mouse.click(960, 540);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    for (const biome of [0, 3, 5]) {
      await page.evaluate((b) => {
        const chunk = window.__mvLab!.findBiomeChunk(b, 0);
        window.__mv!.warp(chunk + 12, 20);
      }, biome);
      for (let cam = 0; cam < 3; cam++) {
        await page.evaluate((m) => { window.__mvE2e!.host.overrideCam?.(m as 0 | 1 | 2); }, cam);
        await nodeWait(1500);
        const shot = info.outputPath(`b${biome}-${CAMS[cam]}.png`);
        await page.screenshot({ path: shot });
        console.log(`SCREENSHOT ${shot}`);
      }
    }
    // HIDE HUD: the readouts go, the dashboard stays.
    await page.evaluate(() => {
      window.__mvE2e!.host.overrideCam?.(1);
      document.querySelector('#mv-ui')!.setAttribute('data-hide-hud', '1');
    });
    await nodeWait(400);
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.mv-box-score')!).visibility);
    expect(hidden).toBe('hidden');
    const shot = info.outputPath('cockpit-hide-hud.png');
    await page.screenshot({ path: shot });
    console.log(`SCREENSHOT ${shot}`);
  });
});
