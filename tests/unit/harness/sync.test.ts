import { describe, expect, it } from 'vitest';
import { createSync } from '../../../src/harness/sync';
import { createGlStub } from './support/glStub';

describe('the same-run guard', () => {
  it('starts disarmed', () => {
    const stub = createGlStub();
    const s = createSync(stub.host.ctx);
    expect(s.isArmed()).toBe(false);
    expect(() => s.full()).toThrow('same run');
    expect(() => { s.fullInto(new Uint8Array(4), 0); }).toThrow('same run');
    expect(stub.reads).toEqual([]);
  });

  it('holds for the rest of the synchronous run and ends at the microtask checkpoint', async () => {
    const s = createSync(createGlStub().host.ctx);
    s.arm();
    expect(s.isArmed()).toBe(true);
    s.arm();
    expect(s.isArmed()).toBe(true);
    await Promise.resolve();
    expect(s.isArmed()).toBe(false);
  });

  it('a second arm after the checkpoint arms again, and ends again', async () => {
    const s = createSync(createGlStub().host.ctx);
    s.arm();
    await Promise.resolve();
    s.arm();
    expect(s.isArmed()).toBe(true);
    await Promise.resolve();
    expect(s.isArmed()).toBe(false);
  });
});

describe('reads', () => {
  it('one reads 1x1 and works disarmed: it is a wait, not a result', () => {
    const stub = createGlStub();
    createSync(stub.host.ctx).one();
    expect(stub.reads).toEqual([{ x: 0, y: 0, w: 1, h: 1, offset: 0 }]);
    expect(stub.renderTargets).toEqual([null]);
  });

  it('one touches no GL while the context is lost', () => {
    const stub = createGlStub();
    stub.lost = true;
    createSync(stub.host.ctx).one();
    expect(stub.reads).toEqual([]);
    expect(stub.renderTargets).toEqual([]);
  });

  it('full binds the canvas and reads the whole buffer into a fresh array', () => {
    const stub = createGlStub();
    const s = createSync(stub.host.ctx);
    s.arm();
    const a = s.full();
    const b = s.full();
    expect(a.length).toBe(64 * 32 * 4);
    expect(a).not.toBe(b);
    expect(stub.renderTargets).toEqual([null, null]);
  });

  it('fullInto writes at the offset it was given', () => {
    const stub = createGlStub();
    const s = createSync(stub.host.ctx);
    const store = new Uint8Array(64 * 32 * 4 * 2);
    s.arm();
    s.fullInto(store, 64 * 32 * 4);
    expect(stub.reads).toEqual([{ x: 0, y: 0, w: 64, h: 32, offset: 64 * 32 * 4 }]);
    expect(store[3]).toBe(0);
    expect(store[64 * 32 * 4 + 3]).toBe(255);
  });

  it('reads the size fresh, since a resize changes it', () => {
    const stub = createGlStub();
    const s = createSync(stub.host.ctx);
    expect([s.width(), s.height()]).toEqual([64, 32]);
    stub.width = 128;
    expect(s.width()).toBe(128);
  });
});
