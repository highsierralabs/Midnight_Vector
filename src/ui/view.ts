// Which panels show. This is the only place that decides, and it reads only mode, autopilot and the lost flag, so the
// UI has no second state machine that could drift from section 7.2. Allocates nothing.
import { SimMode } from '../contracts/index';

export const Panel = { TITLE: 1, HUD: 2, MENU: 4, LOST: 8, AUTO: 16, CTX: 32 } as const;
const PANEL_NAMES = ['title', 'hud', 'menu', 'lost', 'auto', 'ctx'] as const;

export function deriveView(mode: SimMode, autopilot: boolean, contextLost: boolean): number {
  let mask = 0;
  if (mode === SimMode.DEMO) mask = Panel.TITLE;
  else if (mode === SimMode.PLAY) mask = autopilot ? Panel.HUD | Panel.AUTO : Panel.HUD;
  else if (mode === SimMode.CRUISE) mask = Panel.HUD | Panel.MENU;
  else if (mode === SimMode.SIGNAL_LOST) mask = Panel.HUD | Panel.LOST;
  return contextLost ? mask | Panel.CTX : mask;
}

// D-012: the HUD and the menu stay laid out under the title, below sight, so the mask also says what a pointer, the
// keyboard and assistive technology may reach. Each is written in the same step as data-view.

/** The HUD is aria-hidden whenever its panel is not shown. */
export function hudHidden(mask: number): boolean {
  return (mask & Panel.HUD) === 0;
}

/** The HUD is inert when it is not shown, and while the menu is open over it. */
export function hudInert(mask: number): boolean {
  return (mask & Panel.HUD) === 0 || (mask & Panel.MENU) !== 0;
}

/** The menu is inert and aria-hidden whenever it is not open. */
export function menuHidden(mask: number): boolean {
  return (mask & Panel.MENU) === 0;
}

/** One data-view value per mask, read by CSS with ~=, so a panel change is one attribute write. */
export function buildViewTable(): readonly string[] {
  const out: string[] = [];
  for (let mask = 0; mask < 1 << PANEL_NAMES.length; mask++) {
    const names: string[] = [];
    for (let bit = 0; bit < PANEL_NAMES.length; bit++) {
      if ((mask & (1 << bit)) !== 0) names.push(PANEL_NAMES[bit]!);
    }
    out.push(names.join(' '));
  }
  return out;
}

/** <html data-mv-mode>, indexed by SimMode. */
export const MODE_NAMES = ['demo', 'play', 'cruise', 'lost'] as const;
