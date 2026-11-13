// Which keys launch. Tab stays navigation for keyboard users, though it does grant activation, and M, P and C (T13: the
// camera) have their own meaning. Escape grants no activation at all, so audio could not start on it even if it launched.

const NEVER = new Set<string>([
  'Tab', 'Escape', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'PrintScreen', 'Pause',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
  'KeyM', 'KeyP', 'KeyC',
]);

export function isLaunchKey(code: string, ctrl: boolean, alt: boolean, meta: boolean): boolean {
  if (ctrl || alt || meta) return false;
  if (NEVER.has(code)) return false;
  if (/^F\d{1,2}$/.test(code)) return false;
  return !(code.startsWith('Audio') || code.startsWith('Browser') || code.startsWith('Media'));
}

/** src/input's steering and boost codes (keys.ts), which src/ui may not import: the keys that mean the ship. */
const SHIP_KEYS = new Set<string>(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']);

/** In PLAY, a key meant for the ship hands a focused II back, so steering goes on and Space boosts (VI-game). Enter and Tab keep it. */
export function releasesMenuButton(code: string): boolean {
  return SHIP_KEYS.has(code);
}

/**
 * DI-95: the title takes a launch only once the game is running. The value is T10's html[data-mv-boot]: 'loading' from
 * before the app is fetched until the first frame, then 'running'. A page with no such attribute, such as dev/ui.html,
 * has no boot to wait for.
 */
export function bootReady(boot: string | null): boolean {
  return boot === null || boot === 'running';
}
