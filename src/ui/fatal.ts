// The fatal page: opaque, with a CSS sunset and a flat SVG grid, no animation and no 3D transform (section 10.1).
// It needs nothing from mount, so it works before mount and after a failed boot.
import type { FatalReason } from '../contracts/index';
import * as copy from './copy';
import { ensureStyle } from './style';

const SVG = 'http://www.w3.org/2000/svg';

/** Rows crowding toward the horizon, and lines fanning toward its centre: the same picture as the world, in flat paths. */
const FAR_ROW = 2;
function rowY(row: number): number {
  return (40 * row * row) / 49;
}

/**
 * The fan stops at the far row rather than meeting at the vanishing point, where 25 lines drew a solid pink wedge
 * (V1-T08). Each line keeps its direction, so the perspective reads the same.
 */
function gridPath(): string {
  const parts: string[] = [];
  const far = rowY(FAR_ROW);
  for (let i = -12; i <= 12; i++) parts.push(`M${(50 + (i * 14 * far) / 40).toFixed(3)} ${far.toFixed(3)}L${50 + i * 14} 40`);
  for (let row = FAR_ROW; row <= 7; row++) {
    const y = rowY(row);
    parts.push(`M-200 ${y.toFixed(3)}L300 ${y.toFixed(3)}`);
  }
  return parts.join('');
}

function grid(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'mv-fatal-grid');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', gridPath());
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
  return svg;
}

/** Never throws: a failure here must not hide the failure that brought us here. */
export function showFatalPage(doc: Document, reason: FatalReason): void {
  try {
    ensureStyle(doc);
    const text = copy.FATAL_COPY[reason] ?? copy.FATAL_COPY['runtime-error'];

    const page = doc.createElement('div');
    page.className = 'mv-fatal';
    page.setAttribute('data-mv', 'fatal');
    page.setAttribute('data-reason', reason);
    page.setAttribute('role', 'alert');

    const sun = doc.createElement('div');
    sun.className = 'mv-fatal-sun';
    sun.setAttribute('aria-hidden', 'true');

    const card = doc.createElement('div');
    card.className = 'mv-fatal-card';
    const heading = doc.createElement('h1');
    heading.className = 'mv-fatal-heading';
    heading.textContent = text.heading;
    const body = doc.createElement('p');
    body.className = 'mv-fatal-body';
    body.textContent = text.body;
    const reload = doc.createElement('button');
    reload.type = 'button';
    reload.className = 'mv-fatal-reload';
    reload.setAttribute('data-mv', 'reload');
    reload.textContent = copy.RELOAD;
    reload.addEventListener('click', () => { doc.location.reload(); });
    card.append(heading, body, reload);

    page.append(sun, grid(doc), card);
    (doc.body ?? doc.documentElement).append(page);
    reload.focus({ preventScroll: true });
  } catch {
    // Nothing is left to report to. The caller has already stopped the loop.
  }
}
