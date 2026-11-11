import { expect, it } from 'vitest';
import { add } from '../../../src/owned/good';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
});
