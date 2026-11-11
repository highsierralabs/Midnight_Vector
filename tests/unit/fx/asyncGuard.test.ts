// A6: the guard around compileAsync.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../../src/render/fx/asyncGuard';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves when the promise does, does not call onTimeout, and leaves no timer', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    await withTimeout(Promise.resolve(1), 1000, onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('on a promise that never resolves, calls onTimeout at the limit and resolves', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let done = false;
    const p = withTimeout(new Promise(() => undefined), 1000, onTimeout).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a rejection through and leaves no timer', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error('lost')), 1000, () => undefined)).rejects.toThrow('lost');
    expect(vi.getTimerCount()).toBe(0);
  });
});
