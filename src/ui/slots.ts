// A slot owns one text node, one style property or one attribute. It remembers what it last wrote and writes only on
// change. Every slot shares one throttle (DI-50): a change after a quiet spell writes at once, so a beat kick is never
// late, and only a value changing faster than the limit waits. Targets are duck-typed, so all of this runs in Node.

/** 6 ticks at 120 Hz is 50 ms, so one target writes at most 20 times per second. */
export const SLOT_MIN_TICKS = 6;

export interface TextTarget { data: string }
export interface StyleTarget { setProperty(prop: string, value: string): void }
export interface AttrTarget { setAttribute(name: string, value: string): void }

export interface Gate {
  /** True when value differs from the last one passed and the throttle is open. The caller then writes. */
  pass(tick: number, value: number): boolean;
}
export interface Slot { set(tick: number, value: number): void }

export function createGate(minTicks: number = SLOT_MIN_TICKS): Gate {
  let wrote = false;
  let shown = 0;
  let last = -Infinity;
  return {
    pass(tick, value) {
      if (wrote && (value === shown || (value !== value && shown !== shown))) return false;
      if (tick < last) last = -Infinity;
      if (tick - last < minTicks) return false;
      wrote = true;
      shown = value;
      last = tick;
      return true;
    },
  };
}

/** format runs only when a write is due, so an unchanged frame compares one number. */
export function createTextSlot(target: TextTarget, format: (value: number) => string, minTicks: number = SLOT_MIN_TICKS): Slot {
  const gate = createGate(minTicks);
  return {
    set(tick, value) {
      if (gate.pass(tick, value)) target.data = format(value);
    },
  };
}

/** value indexes a table built once at mount, so a write allocates nothing. */
export function createStyleSlot(target: StyleTarget, prop: string, table: readonly string[], minTicks: number = SLOT_MIN_TICKS): Slot {
  const gate = createGate(minTicks);
  return {
    set(tick, value) {
      if (gate.pass(tick, value)) target.setProperty(prop, table[value] ?? '');
    },
  };
}

export function createAttrSlot(target: AttrTarget, name: string, table: readonly string[], minTicks: number = SLOT_MIN_TICKS): Slot {
  const gate = createGate(minTicks);
  return {
    set(tick, value) {
      if (gate.pass(tick, value)) target.setAttribute(name, table[value] ?? '');
    },
  };
}

/** Overdrive's fill has this many steps, so a sweep costs no strings. */
export const SCALE_LEVELS = 128;

/** scaleX(0) to scaleX(1) in SCALE_LEVELS + 1 prebuilt strings. Build once at mount. */
export function buildScaleTable(): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= SCALE_LEVELS; i++) out.push(`scaleX(${i / SCALE_LEVELS})`);
  return out;
}
