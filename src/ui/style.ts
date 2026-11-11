// One <style>, injected once and carried in the bundle, so the fatal page keeps its styling even after a failed load.
import css from './ui.css?inline';

const STYLE_ID = 'mv-ui-style';

export function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  (doc.head ?? doc.documentElement).append(el);
}
