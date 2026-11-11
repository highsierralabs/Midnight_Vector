// The app's side of the seam: its own URL parser decides, and only then does it import the harness dynamically. It uses a
// three symbol so that shared chunks are exercised, as they will be in the real build.
import { REVISION } from 'three';

function hasHarnessFlag(search: string): boolean {
  return new URLSearchParams(search).has('harness');
}

export async function bootApp(search: string): Promise<string> {
  if (hasHarnessFlag(search)) {
    const m = await import('../../../../../src/harness/index');
    return `three r${REVISION}, harness ${typeof m.createHarness}`;
  }
  return `three r${REVISION}, no harness`;
}
