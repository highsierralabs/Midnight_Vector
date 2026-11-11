// The one WebGLRenderer, on the canvas main.ts pre-checked, with section 6.6's flags.
import { WebGLRenderer } from 'three';

/** Same test as tests/support/rasterizer.ts, on the unmasked string. Never /Vulkan/: SwiftShader's string names Vulkan. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

/**
 * Throws when three cannot create the context. onShaderError replaces three's own console.error (Agents.md), so the
 * handler passed in must log as well as route.
 */
export function createRendererOn(canvas: HTMLCanvasElement, onShaderError: (log: string) => void): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const parts = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)];
    let log = '';
    for (const p of parts) if (p) log += (log === '' ? '' : '\n') + p;
    onShaderError(log);
  };
  return renderer;
}

/** The unmasked renderer string, or gl.RENDERER where the extension is missing; that reads `WebKit WebGL` [O]. */
export function readRendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}
