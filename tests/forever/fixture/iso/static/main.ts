// The negative control: a static import of the harness, which is exactly what section 11.3 forbids. A normal visit must
// fetch the marker here, so the isolation test can tell the difference.
import { REVISION } from 'three';
import { createHarness } from '../../../../../src/harness/index';

const out = document.querySelector('#out');
if (out) out.textContent = `three r${REVISION}, harness ${typeof createHarness}`;
