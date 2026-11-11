// The page's entry. The pre-check runs on the canvas the renderer will use, so the page holds one WebGL context, never
// two (section 11.5). An unsupported client keeps the poster and never fetches the engine: the app is a dynamic import.
const ATTRS: WebGLContextAttributes = {
  alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true,
  preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
};
const root = document.documentElement;
const stage = document.getElementById('mv-stage')!;
const uiRoot = document.getElementById('mv-ui')!;
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2', ATTRS);
const ok = gl !== null && (gl.getExtension('EXT_color_buffer_float') !== null || gl.getExtension('EXT_color_buffer_half_float') !== null);
if (!ok) {
  root.dataset['mvBoot'] = 'unsupported';
  document.getElementById('mv-poster-title')!.textContent = 'NO SIGNAL';
  document.getElementById('mv-poster-msg')!.textContent = 'This browser or device could not start WebGL2 with floating-point render targets, which this game needs. The latest Chrome, Edge, Firefox or Safari on a recent device should run it.';
} else {
  stage.appendChild(canvas);
  root.dataset['mvBoot'] = 'loading';
  import('./app/index')
    .then((m) => m.bootApp({ canvas, stage, uiRoot, search: location.search }))
    .catch((e: unknown) => {
      console.error('BOOT_FAILED', e);
      root.dataset['mvBoot'] = 'failed';     // CSS has no rule for this value, so the poster copy shows
      document.getElementById('mv-poster-title')!.textContent = 'NO SIGNAL';
      document.getElementById('mv-poster-msg')!.textContent = 'The game failed to load. Reloading the page may help.';
    });
}
