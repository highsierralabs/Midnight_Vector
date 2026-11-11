// KeyboardEvent.code to steering and boost. Pure, so the table can be proven in Node. Esc, P and M are src/ui's.

/** One bit per physical key, so W and ArrowUp held together survive releasing either. */
export const KeyBit = {
  KEY_W: 1 << 0, KEY_A: 1 << 1, KEY_S: 1 << 2, KEY_D: 1 << 3,
  ARROW_UP: 1 << 4, ARROW_LEFT: 1 << 5, ARROW_DOWN: 1 << 6, ARROW_RIGHT: 1 << 7,
  SPACE: 1 << 8,
} as const;

export const UP_MASK = KeyBit.KEY_W | KeyBit.ARROW_UP;
export const DOWN_MASK = KeyBit.KEY_S | KeyBit.ARROW_DOWN;
export const LEFT_MASK = KeyBit.KEY_A | KeyBit.ARROW_LEFT;
export const RIGHT_MASK = KeyBit.KEY_D | KeyBit.ARROW_RIGHT;
export const STEER_MASK = UP_MASK | DOWN_MASK | LEFT_MASK | RIGHT_MASK;
export const BOOST_MASK = KeyBit.SPACE;

const TABLE: ReadonlyMap<string, number> = new Map<string, number>([
  ['KeyW', KeyBit.KEY_W], ['KeyA', KeyBit.KEY_A], ['KeyS', KeyBit.KEY_S], ['KeyD', KeyBit.KEY_D],
  ['ArrowUp', KeyBit.ARROW_UP], ['ArrowLeft', KeyBit.ARROW_LEFT], ['ArrowDown', KeyBit.ARROW_DOWN], ['ArrowRight', KeyBit.ARROW_RIGHT],
  ['Space', KeyBit.SPACE],
]);

/** The key's bit, or 0 when input does not handle this code. */
export function keyBit(code: string): number {
  return TABLE.get(code) ?? 0;
}

/**
 * Whether a key pressed on the focused control keeps its own meaning there, so input leaves it alone (VI-game). Space
 * and Enter press a button or tick a box, and those keys only: arrows and WASD mean nothing on a button, so they steer,
 * and a focused II no longer stops the ship. A radio keeps its arrows too, which choose within its group. A slider, a
 * text field, a select and editable text keep every key. Anything else, the page itself included, keeps none.
 * tag is Element.tagName, type an input's type in lower case, editable isContentEditable.
 */
export function keepsKey(tag: string, type: string, editable: boolean, code: string): boolean {
  if (editable) return true;
  const press = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';
  if (tag === 'BUTTON') return press;
  if (tag === 'INPUT') {
    if (type === 'checkbox' || type === 'button' || type === 'submit' || type === 'reset') return press;
    if (type === 'radio') return press || code.startsWith('Arrow');
    return true;
  }
  return tag === 'SELECT' || tag === 'TEXTAREA';
}
