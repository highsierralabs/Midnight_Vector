import { expect, it } from 'vitest';

it('a sibling test that fails, and must not fail another task', () => {
  expect(1).toBe(2);
});
