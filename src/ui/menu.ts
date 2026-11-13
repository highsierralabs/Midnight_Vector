// The cruise menu. Native controls give roles and arrow keys for free, and every change persists at once.
import type { CamMode, FrameView, Tier, UiCommands } from '../contracts/index';
import * as copy from './copy';
import type { UiDom } from './dom';
import { formatKm, formatScore, kmKey } from './format';
import { createGate, createTextSlot } from './slots';
import { nextCam, saveSettings, type Bests, type Settings, type StoreLike } from './storage';

export interface Menu {
  frame(v: Readonly<FrameView>, run: Float64Array, bests: Readonly<Bests>): void;
  /**
   * The panel was written open or closed, so focus can follow the real DOM state. inert is index.ts's, written first
   * (D-012). ring: a keyboard moved focus last, so RESUME shows the focus ring; after a tap or a click it does not (A24).
   */
  setOpen(open: boolean, ring: boolean): void;
  toggleMute(): void;
  /** T13: the C key. The next camera, as if its radio had been chosen. */
  cycleCam(): void;
  /** Amendment LH: a start button chose the HUD. The same setting as the HIDE HUD box, written only on a change. */
  chooseHud(hide: boolean): void;
  /** Keydown on window: Tab with the focus outside the open dialog goes back into it. */
  guardTab(e: KeyboardEvent): void;
  /** The OS preference changed. Followed only while the player has set no override. */
  osReducedChanged(on: boolean): void;
}

function qualityValue(raw: string): Tier | 'auto' {
  return raw === '0' ? 0 : raw === '1' ? 1 : raw === '2' ? 2 : raw === '3' ? 3 : raw === '4' ? 4 : 'auto';
}

function percent(v: number): string {
  return String(Math.round(v * 100));
}

export function createMenu(
  dom: UiDom, cmd: UiCommands, settings: Settings, store: StoreLike, setMutedChip: (on: boolean) => void,
  setHideHud: (on: boolean) => void, initialReduced: boolean,
): Menu {
  let open = false;

  function persist(): void { saveSettings(store, settings); }
  function sendVolume(): void {
    if (settings.muted) cmd.setVolume(0, 0);
    else cmd.setVolume(settings.music, settings.sfx);
  }
  function showMute(): void {
    dom.mute.checked = settings.muted;
    setMutedChip(settings.muted);
  }

  dom.music.value = percent(settings.music);
  dom.sfx.value = percent(settings.sfx);
  dom.reduced.checked = initialReduced;
  showMute();
  // Amendment FH: HIDE HUD is a setting like MUTE, written to the root at mount and on change, never per frame.
  dom.hideHud.checked = settings.hideHud;
  setHideHud(settings.hideHud);
  for (const radio of dom.quality) radio.checked = qualityValue(radio.value) === settings.quality;

  function volumeInput(): void {
    settings.music = dom.music.valueAsNumber / 100;
    settings.sfx = dom.sfx.valueAsNumber / 100;
    // A slider is a request to hear something, so moving one while muted unmutes.
    settings.muted = false;
    showMute();
    sendVolume();
    persist();
  }
  dom.music.addEventListener('input', volumeInput);
  dom.sfx.addEventListener('input', volumeInput);

  function setMuted(on: boolean): void {
    settings.muted = on;
    showMute();
    sendVolume();
    persist();
  }
  dom.mute.addEventListener('change', () => { setMuted(dom.mute.checked); });

  for (const radio of dom.quality) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      settings.quality = qualityValue(radio.value);
      cmd.setQuality(settings.quality);
      persist();
    });
  }

  // T13: the camera. The button and the C key both step to the next one.
  function showCam(m: CamMode): void {
    dom.camName.data = copy.CAMERA_NAMES[m]!;
    dom.cam.setAttribute('aria-label', copy.CAMERA_ARIA[m]!);
  }
  function setCam(m: CamMode): void {
    settings.cam = m;
    showCam(m);
    cmd.setCamMode(m);
    persist();
  }
  showCam(settings.cam);
  dom.cam.addEventListener('click', () => { setCam(nextCam(settings.cam)); });

  dom.reduced.addEventListener('change', () => {
    settings.reduced = dom.reduced.checked;
    cmd.setReducedMotion(settings.reduced);
    persist();
  });

  // No command: hiding the readouts is the UI's own business, and the HUD's slots keep writing behind it (FH-16).
  dom.hideHud.addEventListener('change', () => {
    settings.hideHud = dom.hideHud.checked;
    setHideHud(settings.hideHud);
    persist();
  });

  // Tab wraps inside the dialog. Radio groups stop at their checked radio, so the two ends are stable controls.
  dom.cruise.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab') return;
    const at = document.activeElement;
    if (e.shiftKey && at === dom.resume) {
      e.preventDefault();
      dom.reduced.focus();
    } else if (!e.shiftKey && at === dom.reduced) {
      e.preventDefault();
      dom.resume.focus();
    }
  });

  const runScore = createTextSlot(dom.runScore, formatScore);
  const runKmGate = createGate();
  const bestScore = createTextSlot(dom.bestScore, formatScore);
  const bestKmGate = createGate();
  const autoLabels: string[] = [];
  for (const t of copy.TIER_ORDER) autoLabels[t] = copy.autoLabel(t);
  const tier = createTextSlot(dom.autoLabel, (t) => autoLabels[t] ?? copy.LABEL_AUTO);

  return {
    frame(v, run, bests) {
      if (!open) return;
      const tick = v.tick;
      const runU = run[0]!;
      runScore.set(tick, v.sim.score);
      if (runKmGate.pass(tick, kmKey(runU))) dom.runKm.data = formatKm(runU);
      bestScore.set(tick, bests.score);
      const bestU = bests.km * 1000;
      if (bestKmGate.pass(tick, kmKey(bestU))) dom.bestKm.data = formatKm(bestU);
      tier.set(tick, v.quality.tier);
    },
    setOpen(next, ring) {
      if (next === open) return;
      open = next;
      dom.menuButton.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (next) {
        // focus-visible semantics: the ring for keyboard focus only. Chromium's own heuristic showed it after a tap on II,
        // the doubled edge V1-T08 removed from the title on touch (VI-game).
        dom.resume.focus({ preventScroll: true, focusVisible: ring });
        return;
      }
      // Back to body, so Space is boost again.
      const at = document.activeElement;
      if (at instanceof HTMLElement && dom.cruise.contains(at)) at.blur();
    },
    toggleMute() { setMuted(!settings.muted); },
    cycleCam() { setCam(nextCam(settings.cam)); },
    chooseHud(hide) {
      if (hide === settings.hideHud) return;
      settings.hideHud = hide;
      dom.hideHud.checked = hide;
      setHideHud(hide);
      persist();
    },
    guardTab(e) {
      if (!open || e.code !== 'Tab') return;
      if (dom.cruise.contains(document.activeElement)) return;
      e.preventDefault();
      dom.resume.focus();
    },
    osReducedChanged(on) {
      if (settings.reduced !== null) return;
      dom.reduced.checked = on;
      cmd.setReducedMotion(on);
    },
  };
}
