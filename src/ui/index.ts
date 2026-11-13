// The only export of this module (section 3.2). Wires the parts. Panels follow only sim.mode, sim.autopilot and the
// context-lost flag, and timers use v.tick, so a scripted frame reproduces any state.
import { CamMode, Ev, SimMode, type CreateUi, type FatalReason, type FrameView, type UiCommands } from '../contracts/index';
import { COCKPIT_SLOTS, cockpitUnit } from '../core/cockpit';
import { buildDom, type UiDom } from './dom';
import { showFatalPage } from './fatal';
import {
  FsApi, createOwnExit, detectFullscreen, escIsBrowsers, exitFullscreen, isFullscreen, leaveOpensCruise, requestFullscreen, takeOwnExit,
} from './fullscreen';
import { bootReady, isLaunchKey, releasesMenuButton } from './gesture';
import { createHud, type Hud } from './hud';
import { createMenu, type Menu } from './menu';
import { createOverlays, type Overlays } from './overlays';
import { createPaletteWriter, type PaletteWriter } from './palette';
import { createPopups, type Popups } from './popups';
import { ROTATE_QUERY, gateHolds, gateParks } from './rotate';
import { createRunMeter } from './run';
import { createAttrSlot, createGate, type Gate, type Slot } from './slots';
import { CAM_NAMES, createBestsTracker, loadSettings, type BestsTracker, type StoreLike } from './storage';
import { ensureStyle } from './style';
import { createTitle, launchChoice, type Title } from './title';
import { MODE_NAMES, Panel, buildViewTable, deriveView, hudHidden, hudInert, menuHidden } from './view';

const NO_YES = ['0', '1'] as const;
/** A tap's click arrives after pointerup, and by then the HUD can sit under the finger: .3 s of no menu button. */
const TAP_THROUGH_TICKS = 36;

/** What a pointer, the keyboard and assistive technology may reach of the HUD and the menu, written with data-view. */
interface Reach { write(mask: number): void }

/** One attribute, set to onValue or removed, written only when it changes. Called on a panel write, never per frame. */
function createFlag(el: HTMLElement, name: string, onValue: string): (on: boolean) => void {
  let state: boolean | null = null;
  return (on) => {
    if (on === state) return;
    state = on;
    if (on) el.setAttribute(name, onValue);
    else el.removeAttribute(name);
  };
}

/**
 * D-012: the HUD and the menu are laid out and drawn under the title, below sight (ui.css), so while hidden they must
 * also be out of reach. The CSS hides them by data-view; this writes inert and aria-hidden in the same step.
 */
function createReach(dom: UiDom): Reach {
  const hudAria = createFlag(dom.hud, 'aria-hidden', 'true');
  const hudInertFlag = createFlag(dom.hud, 'inert', '');
  const menuAria = createFlag(dom.cruise, 'aria-hidden', 'true');
  const menuInertFlag = createFlag(dom.cruise, 'inert', '');
  return {
    write(mask) {
      hudAria(hudHidden(mask));
      hudInertFlag(hudInert(mask));
      const menu = menuHidden(mask);
      menuAria(menu);
      menuInertFlag(menu);
    },
  };
}

/** FH-8: the last fullscreen change that left fullscreen, held for the next frame, which reads and clears it. */
interface Leave { pending: boolean; wasIn: boolean; isIn: boolean; own: boolean }

/**
 * Amendment FH, FH-3 to FH-9 and FH-26: the FULLSCREEN box. Where the browser has no element fullscreen the row is
 * hidden. Otherwise the box asks for fullscreen or for an exit in its change handler, which carries the click's, tap's
 * or key's activation, and always shows the real state, read again on both change events, both error events and when
 * each request or exit settles: the browser decides, and Esc, its own control or the OS can end fullscreen at any time.
 */
function wireFullscreen(dom: UiDom, leave: Leave): void {
  const doc = document;
  const target = doc.documentElement;
  const api = detectFullscreen(doc, target);
  if (api === FsApi.NONE) {
    dom.fullscreenRow.hidden = true;
    return;
  }
  const mark = createOwnExit();
  let wasIn = isFullscreen(doc);
  const show = (): void => { dom.fullscreen.checked = isFullscreen(doc); };
  show();
  // FH-35: a standard request or exit settles with the element already updated [O: P5], so the box is read again then,
  // which also reverts a refusal. The prefixed calls return nothing and the element changes later, so a read on settle
  // would flip the box back until the event; that form is followed by its own change and error events alone.
  const readOnSettle = api === FsApi.STANDARD;
  dom.fullscreen.addEventListener('change', () => {
    const asked = dom.fullscreen.checked ? requestFullscreen(api, target) : exitFullscreen(api, doc, mark);
    if (readOnSettle) void asked.then(show);
  });
  const changed = (): void => {
    const isIn = isFullscreen(doc);
    const own = takeOwnExit(mark, isIn);
    if (wasIn && !isIn) {
      leave.pending = true;
      leave.wasIn = wasIn;
      leave.isIn = isIn;
      leave.own = own;
    }
    wasIn = isIn;
    show();
  };
  // A browser fires only the change event of the API it was asked through [O: P1], so the box listens to both.
  doc.addEventListener('fullscreenchange', changed);
  doc.addEventListener('webkitfullscreenchange', changed);
  doc.addEventListener('fullscreenerror', show);
  doc.addEventListener('webkitfullscreenerror', show);
}

/** A property read, not a capture: reading window.localStorage is itself what throws when storage is blocked. */
const pageStore: StoreLike = {
  getItem(key) { return window.localStorage.getItem(key); },
  setItem(key, value) { window.localStorage.setItem(key, value); },
};

interface Parts {
  dom: UiDom; hud: Hud; menu: Menu; overlays: Overlays; popups: Popups; title: Title; palette: PaletteWriter; bests: BestsTracker;
  panelGate: Gate; viewTable: readonly string[]; modeAttr: Slot; reducedAttr: Slot; camAttr: Slot; dashAttr: Slot; reach: Reach; cmd: UiCommands;
}

export const createUi: CreateUi = () => {
  let parts: Parts | null = null;
  let fatal = false;
  let contextLost = false;
  let lastMode: SimMode = SimMode.DEMO;
  let lastTick = 0;
  let demoExitTick = -1;
  let shownMask: number = Panel.TITLE;
  /** A keyboard moved focus last, rather than a pointer, so the menu's focus shows its ring (A24). Set at mount. */
  let keyboardFocus = true;
  // DEMO can run for hours, so a run's distance does not start at chunk 0, and it counts only while score does (DI-61).
  const runMeter = createRunMeter();
  const run = new Float64Array(1);
  const leave: Leave = { pending: false, wasIn: false, isIn: false, own: false };
  /** Amendment LS: the rotate gate shows, and it came up since the last frame, which parks a run once. */
  let gated = false;
  let gatePending = false;

  function mount(root: HTMLElement, cmd: UiCommands): void {
    if (parts || fatal) return;
    ensureStyle(document);
    root.classList.add('mv-ui');

    const settings = loadSettings(pageStore);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = settings.reduced ?? media.matches;

    const viewTable = buildViewTable();
    root.setAttribute('data-view', viewTable[Panel.TITLE]!);
    root.setAttribute('data-reduced', reduced ? '1' : '0');
    // T13: the camera the frame was drawn with, and whether the readouts sit on the cockpit's dashboard.
    root.setAttribute('data-cam', CAM_NAMES[CamMode.CHASE]);
    root.setAttribute('data-dash', '0');
    // Amendment LS: a phone held upright gets the rotate gate. Read before the tree is built, so no frame shows the title
    // first, and again on every change of the one query (rotate.ts), never per frame.
    const rotateQuery = window.matchMedia(ROTATE_QUERY);
    gated = rotateQuery.matches;
    root.setAttribute('data-rotate', gated ? '1' : '0');
    // T13: where the dashboard is, for ui.css. Each slot's corner and size in cockpit units, written once, and one cockpit
    // unit in CSS pixels, kept by a resize observer and never written per frame. The props layer scales the dashboard it
    // draws by the same unit of the same stage, so a readout lands on its panel.
    for (const name of ['score', 'status', 'nav'] as const) {
      const r = COCKPIT_SLOTS[name];
      root.style.setProperty(`--mv-${name}-x`, String(r.x0));
      root.style.setProperty(`--mv-${name}-y`, String(r.y0));
      root.style.setProperty(`--mv-${name}-w`, String(r.x1 - r.x0));
      root.style.setProperty(`--mv-${name}-h`, String(r.y1 - r.y0));
    }
    const writeCockpitUnit = (): void => {
      root.style.setProperty('--mv-cu', `${cockpitUnit(root.clientWidth, root.clientHeight)}px`);
    };
    writeCockpitUnit();
    new ResizeObserver(writeCockpitUnit).observe(root);
    document.documentElement.setAttribute('data-mv-mode', MODE_NAMES[SimMode.DEMO]);

    const dom = buildDom(document, root);
    // In the same task as the tree, so no frame draws the warm HUD or menu while they are still reachable.
    const reach = createReach(dom);
    reach.write(Panel.TITLE);
    const bests = createBestsTracker(pageStore);

    const menu = createMenu(
      dom, cmd, settings, pageStore,
      (on) => { root.setAttribute('data-muted', on ? '1' : '0'); },
      (on) => { root.setAttribute('data-hide-hud', on ? '1' : '0'); },
      reduced,
    );

    /** hideHud: a start button's choice, or null for the remembered setting (amendment LH, LH-3). */
    function tryLaunch(hideHud: boolean | null): void {
      // DI-95: a press while the app still loads would start the run and its audio under a title that stays drawn. The
      // attribute is read in the handler, which reads no layout; ui.css shows LOADING from the same attribute.
      if (lastMode !== SimMode.DEMO || fatal || !bootReady(document.documentElement.getAttribute('data-mv-boot'))) return;
      // Amendment LS: nothing starts under the rotate gate. The gate takes every touch, and this stops a key as well.
      if (gateHolds(gated, lastMode)) return;
      // Before the launch, so the run's first PLAY frame already has the chosen HUD.
      if (hideHud !== null) menu.chooseHud(hideHud);
      cmd.launch();
    }
    function tryToggle(): void {
      // Amendment LS: under the rotate gate a pause goes through and a resume waits.
      if (gateHolds(gated, lastMode)) return;
      if (!fatal && (lastMode === SimMode.PLAY || lastMode === SimMode.CRUISE)) cmd.togglePause();
    }

    const title = createTitle(dom, bests.current, tryLaunch);
    wireFullscreen(dom, leave);

    dom.resume.addEventListener('click', tryToggle);
    dom.menuButton.addEventListener('click', () => {
      if (demoExitTick >= 0 && lastTick - demoExitTick < TAP_THROUGH_TICKS) return;
      tryToggle();
    });
    // A pointer never takes focus from these, or Space would press the button in place of boosting.
    for (const b of [dom.menuButton, dom.boostButton]) {
      b.addEventListener('mousedown', (e) => { e.preventDefault(); });
    }
    // VI-game: in PLAY a Tab reaches II, and with focus there Space pressed it and steering stopped. A key meant for the
    // ship hands focus back: II is blurred in the capture phase on window, ahead of src/input's bubble listener, which
    // reads the focus as it stands then, and Space's own press of the button is cancelled, so it boosts at once.
    window.addEventListener('keydown', (e) => {
      if (fatal || lastMode !== SimMode.PLAY || document.activeElement !== dom.menuButton) return;
      if (e.ctrlKey || e.altKey || e.metaKey || !releasesMenuButton(e.code)) return;
      if (e.code === 'Space') e.preventDefault();
      dom.menuButton.blur();
    }, { capture: true });
    // A24: which device moved focus last. Before any, the launch button's rule below: a fine pointer shows the ring.
    window.addEventListener('keydown', () => { keyboardFocus = true; }, { capture: true, passive: true });
    window.addEventListener('pointerdown', () => { keyboardFocus = false; }, { capture: true, passive: true });

    window.addEventListener('keydown', (e) => {
      title.noteActivity();
      if (fatal) return;
      menu.guardTab(e);
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const code = e.code;
      if (code === 'KeyM') {
        if (!e.repeat) menu.toggleMute();
      } else if (code === 'KeyC') {
        // T13: the next camera. Not on the title, which always shows chase and has no control that would show the change.
        if (!e.repeat && lastMode !== SimMode.DEMO) menu.cycleCam();
      } else if (code === 'Escape' || code === 'KeyP') {
        // FH-7: in fullscreen Esc is the browser's, which leaves fullscreen with it; from PLAY, FH-8 then opens CRUISE.
        if (!e.repeat && !(code === 'Escape' && escIsBrowsers(document))) tryToggle();
      } else if (!e.repeat && isLaunchKey(code, false, false, false)) {
        // LH-3: a key launches the focused start button's choice, and anywhere else the remembered one.
        tryLaunch(launchChoice(dom, document.activeElement));
      }
    });
    window.addEventListener('pointerdown', () => { title.noteActivity(); }, { passive: true });
    window.addEventListener('pointermove', () => { title.noteActivity(); }, { passive: true });
    window.addEventListener('pagehide', () => { bests.flush(); });
    media.addEventListener('change', (e) => { menu.osReducedChanged(e.matches); });

    parts = {
      dom, title, menu, bests, viewTable, reach, cmd,
      hud: createHud(dom),
      overlays: createOverlays(dom),
      popups: createPopups(dom),
      palette: createPaletteWriter(root.style),
      panelGate: createGate(),
      modeAttr: createAttrSlot(document.documentElement, 'data-mv-mode', MODE_NAMES),
      reducedAttr: createAttrSlot(root, 'data-reduced', NO_YES),
      camAttr: createAttrSlot(root, 'data-cam', CAM_NAMES),
      dashAttr: createAttrSlot(root, 'data-dash', NO_YES),
    };

    // Mount sends these at once, so their targets must exist before mount (UiCommands).
    if (settings.muted) cmd.setVolume(0, 0);
    else cmd.setVolume(settings.music, settings.sfx);
    if (settings.quality !== 'auto') cmd.setQuality(settings.quality);
    cmd.setReducedMotion(reduced);
    cmd.setCamMode(settings.cam);

    // On a touch screen nobody asked for focus, and the ring only doubled the button's edge (V1-T08). Focus is still
    // there for Enter and a screen reader, and the ring returns as soon as a keyboard moves it.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    keyboardFocus = !coarse;
    // LH-4: the start button that matches the remembered choice, so a key alone repeats it.
    const start = settings.hideHud ? dom.launchNoHud : dom.launch;
    start.focus(coarse ? { preventScroll: true, focusVisible: false } : { preventScroll: true });

    rotateQuery.addEventListener('change', (e) => {
      gated = e.matches;
      gatePending = gated;
      root.setAttribute('data-rotate', gated ? '1' : '0');
      // Turned back on the title, the start button takes the focus it could not hold while hidden.
      if (!gated && !fatal && lastMode === SimMode.DEMO) start.focus({ preventScroll: true, focusVisible: false });
    });
  }

  function frame(v: Readonly<FrameView>): void {
    if (fatal || !parts) return;
    const p = parts;
    const s = v.sim;
    const tick = v.tick;

    // FH-8: fullscreen left by anything but the box parks a run that this frame finds in PLAY, once. The flag goes on
    // this frame whatever the mode. FH-36: this comes before the mode is read. T10's togglePause commands the sim, whose
    // live state FrameView.sim is, and the sim applies it at once (mode CRUISE, autopilot on), so the rest of this frame
    // reads CRUISE from both, as the frame after P does; read earlier, the mode was PLAY beside the new autopilot.
    if (leave.pending) {
      leave.pending = false;
      if (leaveOpensCruise(leave.wasIn, leave.isIn, leave.own, s.mode)) p.cmd.togglePause();
    }

    // Amendment LS: the rotate gate parks a run it finds in PLAY, once, and before the mode is read, for FH-36's reason.
    if (gatePending) {
      gatePending = false;
      if (gateParks(gated, s.mode)) p.cmd.togglePause();
    }

    const mode = s.mode;
    lastTick = tick;

    if (mode !== lastMode) {
      if (lastMode === SimMode.DEMO) {
        demoExitTick = tick;
        const at = document.activeElement;
        // So Space becomes boost rather than pressing whatever was focused on the title.
        if (at instanceof HTMLElement) at.blur();
      }
      lastMode = mode;
    }

    p.title.frame(tick, mode);
    p.modeAttr.set(tick, mode);
    p.reducedAttr.set(tick, v.reducedMotion ? 1 : 0);
    p.camAttr.set(tick, v.camMode);
    p.dashAttr.set(tick, v.camMode === CamMode.COCKPIT && v.cockpitIn >= 1 ? 1 : 0);
    p.palette.frame(tick, v.zone);

    const mask = deriveView(mode, s.autopilot, contextLost);
    if (p.panelGate.pass(tick, mask)) {
      const previous = shownMask;
      shownMask = mask;
      p.dom.root.setAttribute('data-view', p.viewTable[mask]!);
      p.reach.write(mask);
      p.overlays.panelsChanged(previous, mask);
      p.menu.setOpen((mask & Panel.MENU) !== 0, keyboardFocus);
    }

    const events = v.events;
    for (let i = 0; i < events.count; i++) {
      const kind = events.kind[i]!;
      p.popups.event(kind, events.value[i]!, events.index[i]!);
      if (kind === Ev.GRADE) p.overlays.grade(tick, events.index[i]!, events.value[i]!);
    }

    runMeter.frame(mode, s.autopilot, s.travel, run);
    p.hud.frame(v, run);
    p.popups.frame(v);
    p.overlays.frame(v);
    p.menu.frame(v, run, p.bests.current);
    if (mode !== SimMode.DEMO) p.bests.update(tick, s.score, run, s.warpSerial);
  }

  return {
    mount,
    frame,
    showContextLost(lost) { contextLost = lost; },
    showFatal(reason: FatalReason) {
      if (fatal) return;
      fatal = true;
      parts?.bests.flush();
      showFatalPage(document, reason);
    },
  };
};
