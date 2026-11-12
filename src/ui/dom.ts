// Builds the whole tree once at mount and hands out references. Nothing below creates a node after this.
import { SHIELD_MAX } from '../contracts/index';
import * as copy from './copy';

export const POPUP_POOL = 6;
export const RADIO_NAME = 'mv-quality';

type Kid = Node | string;

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, attrs: Readonly<Record<string, string>>, ...kids: readonly Kid[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const name of Object.keys(attrs)) el.setAttribute(name, attrs[name]!);
  for (const kid of kids) el.append(kid);
  return el;
}

export interface UiDom {
  readonly root: HTMLElement;

  readonly title: HTMLElement;
  /** LAUNCH, with the HUD. Keeps the contract's `launch` hook. */
  readonly launch: HTMLButtonElement;
  /** Amendment LH: LAUNCH - NO HUD. */
  readonly launchNoHud: HTMLButtonElement;
  readonly best: Text;

  readonly hud: HTMLElement;
  readonly score: Text;
  readonly scoreEl: HTMLElement;
  readonly sync: Text;
  readonly syncEl: HTMLElement;
  readonly shields: HTMLElement;
  readonly overdrive: HTMLElement;
  readonly overdriveFill: HTMLElement;
  readonly km: Text;
  readonly sector: Text;
  readonly objective: Text;
  readonly menuButton: HTMLButtonElement;
  readonly boostButton: HTMLButtonElement;

  readonly popups: readonly HTMLElement[];
  readonly popupText: readonly Text[];

  readonly banner: HTMLElement;
  readonly bannerTitle: Text;
  readonly bannerObjective: Text;
  readonly bannerGrade: Text;

  /** The autopilot tag. Overlays writes its data-show, so it leaves the road a few seconds after it appears. */
  readonly autoTag: HTMLElement;

  readonly live: Text;

  readonly cruise: HTMLElement;
  readonly resume: HTMLButtonElement;
  readonly music: HTMLInputElement;
  readonly sfx: HTMLInputElement;
  readonly mute: HTMLInputElement;
  readonly quality: readonly HTMLInputElement[];
  readonly autoLabel: Text;
  /** Amendment FH. The row is hidden where the browser has no element fullscreen; ui.css makes hidden mean not drawn. */
  readonly fullscreen: HTMLInputElement;
  readonly fullscreenRow: HTMLElement;
  readonly hideHud: HTMLInputElement;
  readonly reduced: HTMLInputElement;
  readonly runScore: Text;
  readonly runKm: Text;
  readonly bestScore: Text;
  readonly bestKm: Text;
}

function legend(doc: Document, cls: string, pairs: readonly (readonly [string, string])[]): HTMLElement {
  const list = h(doc, 'ul', { class: `mv-legend ${cls}` });
  for (const [control, action] of pairs) {
    list.append(h(doc, 'li', {}, h(doc, 'b', {}, control), ' ', action));
  }
  return list;
}

function checkRow(doc: Document, label: string, attrs: Readonly<Record<string, string>>): { row: HTMLElement; box: HTMLInputElement } {
  const box = h(doc, 'input', { type: 'checkbox', ...attrs });
  return { box, row: h(doc, 'label', { class: 'mv-row mv-check' }, box, h(doc, 'span', {}, label)) };
}

function rangeRow(doc: Document, label: string, hook: string): { row: HTMLElement; range: HTMLInputElement } {
  const range = h(doc, 'input', { type: 'range', class: 'mv-range', min: '0', max: '100', step: '5', 'data-mv': hook });
  return { range, row: h(doc, 'label', { class: 'mv-row mv-slider' }, h(doc, 'span', { class: 'mv-label' }, label), range) };
}

export function buildDom(doc: Document, root: HTMLElement): UiDom {
  // Title.
  const best = doc.createTextNode('');
  // Amendment LH: two start buttons. ui.css shows LOADING in LAUNCH until html[data-mv-boot] reads running (DI-95).
  const launch = h(doc, 'button', { type: 'button', class: 'mv-launch mv-launch-hud', 'data-mv': 'launch' },
    h(doc, 'span', { class: 'mv-launch-label' }, copy.LAUNCH_HUD),
    h(doc, 'span', { class: 'mv-if-loading' }, copy.PROMPT_LOADING));
  const launchNoHud = h(doc, 'button', { type: 'button', class: 'mv-launch mv-launch-nohud', 'data-mv': 'launch-nohud' },
    h(doc, 'span', { class: 'mv-launch-label' }, copy.LAUNCH_NO_HUD));
  const title = h(doc, 'div', { class: 'mv-title', 'data-mv': 'title', 'data-attract': '0' },
    h(doc, 'h1', { class: 'mv-wordmark', 'data-mv': 'wordmark', 'aria-label': 'Midnight Vector' },
      h(doc, 'span', { class: 'mv-wm mv-wm-top', 'aria-hidden': 'true' }, 'MIDNIGHT'),
      ' ',
      h(doc, 'span', { class: 'mv-wm mv-wm-bottom', 'aria-hidden': 'true' }, 'VECTOR')),
    h(doc, 'div', { class: 'mv-title-bottom' },
      h(doc, 'p', { class: 'mv-tagline' }, copy.TAGLINE),
      h(doc, 'p', { class: 'mv-best', 'data-mv': 'best' }, best),
      h(doc, 'div', { class: 'mv-launches' }, launch, launchNoHud),
      legend(doc, 'mv-if-fine', copy.LEGEND_KEYS),
      legend(doc, 'mv-if-coarse', copy.LEGEND_TOUCH)));

  // HUD.
  const score = doc.createTextNode('00000000');
  const scoreEl = h(doc, 'span', { class: 'mv-score', 'data-mv': 'score', 'data-long': '0' }, score);
  const sync = doc.createTextNode('');
  const syncEl = h(doc, 'span', { class: 'mv-sync', 'data-mv': 'sync', 'data-beat': 'a' }, sync);
  const km = doc.createTextNode('0.0');
  const sector = doc.createTextNode('');
  const objective = doc.createTextNode('');
  const pips: HTMLElement[] = [];
  for (let i = 0; i < SHIELD_MAX; i++) pips.push(h(doc, 'i', { class: 'mv-pip' }));
  const shields = h(doc, 'div', {
    class: 'mv-pips', 'data-mv': 'shields', role: 'img', 'data-n': String(SHIELD_MAX), 'data-ghost': '0',
    'aria-label': `Shields ${SHIELD_MAX} of ${SHIELD_MAX}`,
  }, ...pips);
  const overdriveFill = h(doc, 'div', { class: 'mv-od-fill' });
  const overdrive = h(doc, 'div', {
    class: 'mv-od', 'data-mv': 'overdrive', role: 'meter', 'aria-label': 'Overdrive',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, overdriveFill);
  // aria-expanded follows the menu; menu.ts writes it when the card opens or closes.
  const menuButton = h(doc, 'button', {
    type: 'button', class: 'mv-menu-button', 'data-mv': 'menu-button', 'aria-label': copy.MENU_BUTTON_NAME,
    'aria-haspopup': 'dialog', 'aria-expanded': 'false',
  }, copy.MENU_BUTTON);
  const boostButton = h(doc, 'button', {
    type: 'button', class: 'mv-boost', 'data-mv': 'boost', 'data-mv-boost': '', tabindex: '-1',
  }, copy.LABEL_BOOST);
  const hud = h(doc, 'div', { class: 'mv-hud', 'data-mv': 'hud' },
    h(doc, 'div', { class: 'mv-panel mv-box-score' },
      h(doc, 'span', { class: 'mv-label' }, copy.LABEL_SCORE),
      scoreEl,
      h(doc, 'div', { class: 'mv-syncrow' }, h(doc, 'span', { class: 'mv-label' }, copy.LABEL_SYNC), syncEl)),
    h(doc, 'div', { class: 'mv-panel mv-box-dist' },
      h(doc, 'div', { class: 'mv-kmrow' },
        h(doc, 'span', { class: 'mv-km', 'data-mv': 'km' }, km),
        h(doc, 'span', { class: 'mv-label' }, copy.LABEL_KM)),
      h(doc, 'span', { class: 'mv-sector', 'data-mv': 'sector' }, sector),
      h(doc, 'span', { class: 'mv-objective', 'data-mv': 'objective' }, objective)),
    h(doc, 'div', { class: 'mv-box-boost' }, boostButton),
    h(doc, 'div', { class: 'mv-panel mv-vitals' },
      h(doc, 'div', { class: 'mv-shieldrow' }, h(doc, 'span', { class: 'mv-label' }, copy.LABEL_SHIELD), shields),
      h(doc, 'div', { class: 'mv-odrow' }, h(doc, 'span', { class: 'mv-label' }, copy.LABEL_OVERDRIVE), overdrive)),
    h(doc, 'div', { class: 'mv-box-menu' },
      h(doc, 'span', { class: 'mv-chip', 'data-mv': 'mute' }, copy.LABEL_MUTED),
      menuButton));

  // Overlays.
  const popups: HTMLElement[] = [];
  const popupText: Text[] = [];
  for (let i = 0; i < POPUP_POOL; i++) {
    const t = doc.createTextNode('');
    popupText.push(t);
    popups.push(h(doc, 'span', { class: 'mv-popup', 'data-k': '' }, t));
  }
  const bannerTitle = doc.createTextNode('');
  const bannerObjective = doc.createTextNode('');
  const bannerGrade = doc.createTextNode('');
  const banner = h(doc, 'div', { class: 'mv-banner', 'data-mv': 'banner', 'data-show': '0' },
    h(doc, 'div', { class: 'mv-banner-title' }, bannerTitle),
    h(doc, 'div', { class: 'mv-banner-objective' }, bannerObjective),
    h(doc, 'div', { class: 'mv-banner-grade' }, bannerGrade));
  const live = doc.createTextNode('');

  // Cruise menu. Resume is first and the reduced checkbox is last, which is what the focus trap wraps between.
  const resume = h(doc, 'button', { type: 'button', class: 'mv-resume', 'data-mv': 'resume' }, copy.RESUME);
  const music = rangeRow(doc, copy.LABEL_MUSIC, 'music');
  const sfx = rangeRow(doc, copy.LABEL_SFX, 'sfx');
  const mute = checkRow(doc, copy.LABEL_MUTE, { 'data-mv': 'mute-toggle' });
  const fullscreen = checkRow(doc, copy.LABEL_FULLSCREEN, { 'data-mv': 'fullscreen' });
  const hideHud = checkRow(doc, copy.LABEL_HIDE_HUD, { 'data-mv': 'hide-hud' });
  const reduced = checkRow(doc, copy.LABEL_REDUCED, { 'data-mv': 'reduced' });
  const autoLabel = doc.createTextNode(copy.LABEL_AUTO);
  const quality: HTMLInputElement[] = [];
  const qualityRows: HTMLElement[] = [];
  const addRadio = (value: string, text: Text | string): void => {
    const radio = h(doc, 'input', { type: 'radio', name: RADIO_NAME, value });
    quality.push(radio);
    qualityRows.push(h(doc, 'label', { class: 'mv-radio' }, radio, h(doc, 'span', {}, text)));
  };
  addRadio('auto', autoLabel);
  for (const t of copy.TIER_ORDER) addRadio(String(t), copy.TIER_NAMES[t]);
  const runScore = doc.createTextNode('');
  const runKm = doc.createTextNode('');
  const bestScore = doc.createTextNode('');
  const bestKm = doc.createTextNode('');
  const cruise = h(doc, 'section', {
    class: 'mv-cruise', 'data-mv': 'cruise', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mv-cruise-heading',
  },
    h(doc, 'div', { class: 'mv-card' },
      h(doc, 'div', { class: 'mv-card-head' },
        h(doc, 'h2', { class: 'mv-cruise-heading', id: 'mv-cruise-heading' }, copy.CRUISE_HEADING),
        h(doc, 'p', { class: 'mv-tagline mv-cruise-tagline' }, copy.TAGLINE),
        resume,
        // A no-break space keeps KM with its number, so a long line breaks at the slash (V1-T08).
        h(doc, 'dl', { class: 'mv-stats' },
          h(doc, 'dt', {}, copy.LABEL_RUN), h(doc, 'dd', {}, runScore, ' / ', runKm, ' KM'),
          h(doc, 'dt', {}, copy.LABEL_BEST), h(doc, 'dd', {}, bestScore, ' / ', bestKm, ' KM')),
        h(doc, 'p', { class: 'mv-note' }, copy.CRUISE_NOTE)),
      h(doc, 'div', { class: 'mv-card-controls' },
        music.row,
        sfx.row,
        mute.row,
        // One choice of six, so one radio group to assistive technology, named by its legend; ui.css draws the radios round.
        h(doc, 'fieldset', { class: 'mv-quality', 'data-mv': 'quality', role: 'radiogroup' },
          h(doc, 'legend', { class: 'mv-label' }, copy.LABEL_QUALITY),
          h(doc, 'div', { class: 'mv-radios' }, ...qualityRows)),
        // Amendment FH (FH-1, FH-2): the three display settings share one row on the radios' columns, so the card grows by
        // no row where it is two-column, and REDUCED MOTION stays last for the trap.
        h(doc, 'div', { class: 'mv-toggles' }, fullscreen.row, hideHud.row, reduced.row))));

  const autoTag = h(doc, 'div', { class: 'mv-auto', 'data-mv': 'autopilot' }, copy.AUTOPILOT_TAG);

  root.append(
    title,
    hud,
    h(doc, 'div', { class: 'mv-popups', 'data-mv': 'popups', 'aria-hidden': 'true' }, ...popups),
    banner,
    autoTag,
    h(doc, 'div', { class: 'mv-lost', 'data-mv': 'signal-lost' },
      h(doc, 'div', { class: 'mv-lost-head' }, copy.SIGNAL_LOST),
      h(doc, 'div', { class: 'mv-lost-sub' }, copy.SIGNAL_LOST_SUB)),
    h(doc, 'div', { class: 'mv-ctx', 'data-mv': 'context-lost' },
      h(doc, 'div', { class: 'mv-ctx-text' }, copy.CONTEXT_LOST)),
    cruise,
    h(doc, 'div', { class: 'mv-live', 'data-mv': 'live', role: 'status', 'aria-live': 'polite' }, live),
  );

  return {
    root, title, launch, launchNoHud, best, hud, score, scoreEl, sync, syncEl, shields, overdrive, overdriveFill, km, sector, objective,
    menuButton, boostButton, popups, popupText, banner, bannerTitle, bannerObjective, bannerGrade, autoTag, live,
    cruise, resume, music: music.range, sfx: sfx.range, mute: mute.box, quality, autoLabel,
    fullscreen: fullscreen.box, fullscreenRow: fullscreen.row, hideHud: hideHud.box, reduced: reduced.box,
    runScore, runKm, bestScore, bestKm,
  };
}
