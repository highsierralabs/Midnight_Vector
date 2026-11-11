// B19's class lines (section 9.2, DI-16, DI-78), as alloc.timing.spec.ts gates them, the URL classes they read, and its
// windows control by target (DI-84, DI-86(2)).
import { describe, expect, it } from 'vitest';
import { classify, classLimitProblems, WINDOWS_CONTROL, windowsControlCheck, type HeapClass } from '../../perf/support/heap';

const LIMITS = { other: 512, world: 20 * 1024, libs: 32 * 1024 } as const;

function classes(o: Partial<Record<HeapClass, number>>): Record<HeapClass, number> {
  return { probe: 0, harness: 0, world: 0, other: 0, libs: 0, engine: 0, ...o };
}

describe('classLimitProblems', () => {
  it('passes the app as T10 measured it: other 296 to 377 B per frame, under DI-78s 512', () => {
    expect(classLimitProblems(classes({ other: 377, libs: 6732.1, engine: 1051.8, harness: 44.7 }), LIMITS)).toEqual([]);
    expect(classLimitProblems(classes({ other: 296 }), LIMITS)).toEqual([]);
  });

  it('holds the line at the limit and fails just past it', () => {
    expect(classLimitProblems(classes({ other: 512 }), LIMITS)).toEqual([]);
    expect(classLimitProblems(classes({ other: 512.1 }), LIMITS)).toEqual(['other 512.1 B/frame over 512']);
  });

  it('fails the other line on the 1024 B control counted as project code, the alloc spec control', () => {
    // allocProbe(1024) read 1037.6 to 1057.8 at the probe URL [O: T09], so with the app's 296 B of project code it is far over.
    const control = classes({ other: 296 + 1037.6 });
    expect(classLimitProblems(control, LIMITS)).toEqual(['other 1333.6 B/frame over 512']);
  });

  it('names every line that fails, and reads NaN as a failure rather than a pass', () => {
    expect(classLimitProblems(classes({ other: 600, world: 30000, libs: 40000 }), LIMITS)).toEqual([
      'other 600.0 B/frame over 512', 'world 30000.0 B/frame over 20480', 'libs 40000.0 B/frame over 32768',
    ]);
    expect(classLimitProblems(classes({ other: Number.NaN }), LIMITS)).toEqual(['other NaN B/frame over 512']);
  });

  it('does not limit probe, harness or engine, which B19 prints or checks on their own', () => {
    expect(classLimitProblems(classes({ probe: 5000, harness: 5000, engine: 5000 }), LIMITS)).toEqual([]);
  });
});

describe('classify', () => {
  it('puts each URL in its class, first match wins', () => {
    expect(classify('http://127.0.0.1:5109/src/harness/hotProbe.ts')).toBe('probe');
    expect(classify('http://127.0.0.1:5109/src/harness/budget.ts')).toBe('harness');
    expect(classify('http://127.0.0.1:5109/src/world/height.ts')).toBe('world');
    expect(classify('http://127.0.0.1:5109/src/render/terrain/atlas.ts')).toBe('other');
    expect(classify('http://127.0.0.1:5109/src/app/loop.ts?t=1793923202042')).toBe('other');
    expect(classify('http://127.0.0.1:5109/node_modules/.vite/p5110/deps/three.module-Dl--ppud.js?v=c4fb36b0')).toBe('libs');
    expect(classify('')).toBe('engine');
  });
});

describe('WINDOWS_CONTROL, B19s windows control by target (DI-86(2))', () => {
  // On and off window medians in B/frame, all read on this machine [O: T09]. App 1024 B: repair D's interleaved probe,
  // 150 and 300 pairs. App 256 B: repair E's B19 run and repair D's probe. No probe: repair D's two interleaved nulls and
  // repair E's E1. Shell: repair E's A15 and repair D's sequential runs.

  it('is interleaved at allocProbe(1024), 1024 +/- 256, on the app; the shell keeps sequential 256 +/- 16', () => {
    expect(WINDOWS_CONTROL.app).toEqual({ form: 'interleaved', bytes: 1024, tol: 256 });
    expect(WINDOWS_CONTROL.shell).toEqual({ form: 'sequential', bytes: 256, tol: 16 });
  });

  it('passes the interleaved 1024 B readings on the app', () => {
    const r = windowsControlCheck('app', 9737.2, 8737.6);
    expect(r.ok).toBe(true);
    expect(r.moved).toBeCloseTo(999.6, 6);
    expect(r.error).toBeCloseTo(24.4, 6);
    expect(windowsControlCheck('app', 9684.8, 8686).ok).toBe(true);
  });

  it('control: a probe of 0 fails the app form', () => {
    expect(windowsControlCheck('app', 8966.4, 9062.8).ok).toBe(false);
    expect(windowsControlCheck('app', 8951.2, 8955.8).ok).toBe(false);
    expect(windowsControlCheck('app', 8923.6, 8845.6).ok).toBe(false);
    // The widest no-probe reading on the app, +127.8 in repair E's scatter run, is a difference only.
    expect(windowsControlCheck('app', 8900 + 127.8, 8900).ok).toBe(false);
    expect(windowsControlCheck('app', 3761.6, 3761.6).ok).toBe(false);
  });

  it('fails the 256 B readings on the app, so the probe size is part of the line and not only the tolerance', () => {
    expect(windowsControlCheck('app', 9134.6, 8909.2).ok).toBe(false);
    expect(windowsControlCheck('app', 9213.4, 8949.2).ok).toBe(false);
    // Repair E's +323.2, the reading DI-86(2) rules on, as a difference.
    expect(windowsControlCheck('app', 8900 + 323.2, 8900).ok).toBe(false);
  });

  it('holds the app line at 768 and 1280, and fails it just past either edge', () => {
    // Half-integers, exact in binary, so the edge is tested and not a rounding error.
    expect(windowsControlCheck('app', 9529.5, 8761.5).ok).toBe(true);
    expect(windowsControlCheck('app', 10041.5, 8761.5).ok).toBe(true);
    expect(windowsControlCheck('app', 9529, 8761.5).ok).toBe(false);
    expect(windowsControlCheck('app', 10042, 8761.5).ok).toBe(false);
  });

  it('keeps the shell exact: 256 passes, no probe fails, and 1024 fails the shell line', () => {
    expect(windowsControlCheck('shell', 4017.6, 3761.6).ok).toBe(true);
    expect(windowsControlCheck('shell', 3761.6, 3761.6).ok).toBe(false);
    expect(windowsControlCheck('shell', 4785.6, 3761.6).ok).toBe(false);
  });

  it('a reading that measured nothing fails on either target', () => {
    expect(windowsControlCheck('app', Number.NaN, 8737.6).ok).toBe(false);
    expect(windowsControlCheck('shell', 4017.6, Number.NaN).ok).toBe(false);
  });
});
