// No Playwright import, so tests/boundaries/rasterizer.test.ts can unit-test it. The string must be the unmasked
// one from WEBGL_debug_renderer_info: gl.RENDERER reads `WebKit WebGL` on both rasterizers [O: T00 rehearsal].
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

/** Returns null when the project got the rasterizer it claims, otherwise what is wrong. */
export function checkRasterizer(project: string, webgl2: boolean, renderer: string): string | null {
  switch (project) {
    case 'gpu':
    case 'gpu-timing':
      if (!webgl2) return `${project} needs WebGL2, and it is missing`;
      if (SOFTWARE_RENDERER.test(renderer)) return `${project} needs a real GPU, and got: ${renderer}`;
      return null;
    case 'software':
      if (!webgl2) return `${project} needs WebGL2, and it is missing`;
      if (!/swiftshader/i.test(renderer)) return `${project} needs SwiftShader, and got: ${renderer}`;
      return null;
    case 'no-webgl':
      return webgl2 ? `${project} needs no WebGL2, and it got: ${renderer}` : null;
    default:
      return `unknown Playwright project: ${project}`;
  }
}
