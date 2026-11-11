import { expect, it } from 'vitest';
import { two } from '../../../src/red/code';

it('is deliberately red', () => {
  expect(two()).toBe(3);
});
