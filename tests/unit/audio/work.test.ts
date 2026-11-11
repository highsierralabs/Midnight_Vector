// D-009: the build queue. drain runs everything, including what items append; runSlice stops once its budget has
// passed after a run, runs an `alone` item only first and ends the slice there, and keeps FIFO order.
import { describe, expect, it } from 'vitest';
import { noiseJob } from '../../../src/audio/impulse';
import { createQueue, drain, fill, hasWork, once, runSlice, type WorkQueue } from '../../../src/audio/work';

/** A clock that moves `cost` ms per run, read by runSlice after each run. */
function fakeClock(): { now: () => number; spend: (ms: number) => void } {
  const c = { t: 0 };
  return { now: () => c.t, spend: (ms) => { c.t += ms; } };
}

describe('D-009 work queue', () => {
  it('drain runs every item in order, including items appended while it runs, and fills to the end', () => {
    const q = createQueue();
    const log: string[] = [];
    const buf = new Float32Array(50000);
    once(q, () => { log.push('a'); once(q, () => log.push('appended')); });
    fill(q, () => noiseJob(buf, 3));
    once(q, () => log.push('b'));
    drain(q);
    expect(log).toEqual(['a', 'b', 'appended']);
    expect(buf[49999]).not.toBe(0);
    expect(hasWork(q)).toBe(false);
  });

  it('runSlice stops at the first run that reaches the budget, and the next slice resumes where it stopped', () => {
    const clock = fakeClock();
    const q = createQueue();
    const ran: number[] = [];
    for (let i = 0; i < 10; i++) once(q, () => { ran.push(i); clock.spend(1); });
    runSlice(q, 2.5, clock.now);
    expect(ran).toEqual([0, 1, 2]);   // 1, 2, 3 ms: the third run reaches 2.5
    runSlice(q, 2.5, clock.now);
    expect(ran).toEqual([0, 1, 2, 3, 4, 5]);
    while (hasWork(q)) runSlice(q, 2.5, clock.now);
    expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('an alone item waits for a fresh slice, runs first in it, and ends it', () => {
    const clock = fakeClock();
    const q = createQueue();
    const log: string[] = [];
    once(q, () => { log.push('small'); clock.spend(0.5); });
    once(q, () => { log.push('alone'); clock.spend(3.5); }, true);
    once(q, () => { log.push('after'); clock.spend(0.5); });
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['small']);
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['small', 'alone']);
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['small', 'alone', 'after']);
  });

  it('a fill that is not finished stays at the head and continues in the same slice while there is budget', () => {
    const clock = fakeClock();
    const q: WorkQueue = createQueue();
    const buf = new Float32Array(10000);
    let steps = 0;
    const job = noiseJob(buf, 1);
    q.items.push({ run: () => { steps += 1; clock.spend(1); return job.step(1000); }, alone: false });
    runSlice(q, 2.5, clock.now);
    expect(steps).toBe(3);
    expect(hasWork(q)).toBe(true);
    while (hasWork(q)) runSlice(q, 2.5, clock.now);
    expect(steps).toBe(10);
  });

  it('a fill sizes its runs from their measured time: halving over .6 ms, doubling under .25 ms, made lazily', () => {
    const clock = fakeClock();
    const q = createQueue();
    const asked: number[] = [];
    let made = 0;
    // A job whose run costs 1 us per sample on the fake clock, 20000 samples in all.
    const st = { left: 20000 };
    once(q, () => { clock.spend(0.01); });
    fill(q, () => {
      made += 1;
      return {
        step(budget: number): boolean {
          asked.push(budget);
          const n = Math.min(budget, st.left);
          clock.spend(n * 0.001);
          st.left -= n;
          return st.left <= 0;
        },
      };
    });
    expect(made).toBe(0);   // nothing is made at queue time
    while (hasWork(q)) runSlice(q, 2.5, clock.now);
    expect(made).toBe(1);
    // The first run, 1024 samples, takes 1.02 ms, so 512, at .51 ms, which is inside the band and holds.
    expect(asked.slice(0, 4)).toEqual([1024, 512, 512, 512]);
    // With a cost of .1 us per sample the same rules grow the run instead.
    const q2 = createQueue();
    const asked2: number[] = [];
    const st2 = { left: 300000 };
    fill(q2, () => ({
      step(budget: number): boolean {
        asked2.push(budget);
        const n = Math.min(budget, st2.left);
        clock.spend(n * 0.0001);
        st2.left -= n;
        return st2.left <= 0;
      },
    }));
    while (hasWork(q2)) runSlice(q2, 2.5, clock.now);
    expect(asked2.slice(0, 4)).toEqual([1024, 2048, 4096, 4096]);   // .1 and .2 ms double, .41 ms holds
  });

  it('an item whose estimate would pass the budget waits for the next slice, and a fill runs alone on its first run', () => {
    const clock = fakeClock();
    const q = createQueue();
    const log: string[] = [];
    once(q, () => { log.push('a'); clock.spend(2.2); });
    once(q, () => { log.push('b'); clock.spend(0.1); });   // estimated at .5: 2.2 + .5 passes 2.5
    fill(q, () => ({ step: () => { log.push('fill'); clock.spend(0.1); return true; } }));
    once(q, () => { log.push('c'); clock.spend(0.1); });
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['a']);
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['a', 'b']);   // b first, then the fill is alone on its first run, so it waits
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['a', 'b', 'fill']);   // and ends its slice
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['a', 'b', 'fill', 'c']);
  });

  it('only the first fill of a kind runs its first run alone, and a costed item starts a slice but lets small ones follow', () => {
    const clock = fakeClock();
    const q = createQueue();
    const log: string[] = [];
    const job = (name: string): (() => { step: () => boolean }) => () => ({ step: () => { log.push(name); clock.spend(0.1); return true; } });
    fill(q, job('n1'), 'noise');
    fill(q, job('n2'), 'noise');
    fill(q, job('i1'), 'impulse');
    once(q, () => { log.push('wire'); clock.spend(1); }, false, 2);
    once(q, () => { log.push('small'); clock.spend(0.1); });
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['n1']);   // alone: the first noise fill
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['n1', 'n2']);   // the second noise fill is not alone, the first impulse fill is
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['n1', 'n2', 'i1']);
    runSlice(q, 2.5, clock.now);
    expect(log).toEqual(['n1', 'n2', 'i1', 'wire', 'small']);   // 2 ms expected, 1 ms taken, then .5 fits
  });

  it('control: a budget of Infinity drains in one slice, so the budget is what splits the work', () => {
    const clock = fakeClock();
    const q = createQueue();
    let n = 0;
    for (let i = 0; i < 10; i++) once(q, () => { n += 1; clock.spend(1); });
    runSlice(q, Infinity, clock.now);
    expect(n).toBe(10);
  });
});
