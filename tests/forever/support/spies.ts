// Installed with addInitScript, so it runs before the page's own code and grants no user activation. Compiles are counted
// on gl.linkProgram, because renderer.info.programs.length stays constant through a recompile [O: T06 probe].
import type { Page } from 'playwright/test';

/**
 * Cuts the page off from Vite's HMR socket. A file a sibling writes, such as T04's hero.glsl, is in this page's module graph,
 * and Vite answers with a full reload, which kills a long sweep mid-run [O: "Execution context was destroyed" 29 s into the
 * allocation suite]. The socket is mocked with no server behind it, so no reload can arrive. No effect on a built page.
 */
export async function isolateFromHmr(page: Page): Promise<void> {
  // Every socket is mocked. V1-T09 accepted that on condition it is narrowed if the app ever opens a socket of its own,
  // so one that does not carry Vite's HMR token is named in the test output instead of passing unseen.
  await page.routeWebSocket(/.*/, (ws) => {
    if (!/[?&]token=/.test(ws.url())) console.log(`HMR mock: also mocked ${ws.url()}, which is not Vite's HMR socket. Narrow isolateFromHmr`);
  });
}

export async function installSpies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__mvLinks = 0;
    if (typeof WebGL2RenderingContext === 'undefined') return;
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.linkProgram;
    proto.linkProgram = function linkProgram(this: WebGL2RenderingContext, program: WebGLProgram): void {
      window.__mvLinks = (window.__mvLinks ?? 0) + 1;
      original.call(this, program);
    };
  });
}
