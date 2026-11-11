import { describe, expect, it } from 'vitest';
import { SOFTWARE_RENDERER, checkRasterizer } from '../support/rasterizer';

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)';

describe('checkRasterizer', () => {
  it('accepts the observed strings on their own projects', () => {
    expect(checkRasterizer('gpu', true, RTX)).toBeNull();
    expect(checkRasterizer('gpu-timing', true, RTX)).toBeNull();
    expect(checkRasterizer('software', true, SWIFTSHADER)).toBeNull();
    expect(checkRasterizer('no-webgl', false, '')).toBeNull();
  });

  it('negative control: SwiftShader under gpu fails', () => {
    expect(checkRasterizer('gpu', true, SWIFTSHADER)).toContain('real GPU');
    expect(checkRasterizer('gpu-timing', true, SWIFTSHADER)).toContain('real GPU');
  });

  it('negative control: the RTX under software fails', () => {
    expect(checkRasterizer('software', true, RTX)).toContain('SwiftShader');
  });

  it('fails with no WebGL2 on any GL project, and with WebGL2 on no-webgl', () => {
    expect(checkRasterizer('gpu', false, '')).toContain('WebGL2');
    expect(checkRasterizer('gpu-timing', false, '')).toContain('WebGL2');
    expect(checkRasterizer('software', false, '')).toContain('WebGL2');
    expect(checkRasterizer('no-webgl', true, RTX)).toContain('no WebGL2');
  });

  it('the masked string cannot pass as software', () => {
    expect(checkRasterizer('software', true, 'WebKit WebGL')).toContain('SwiftShader');
  });

  it('an unknown project is a failure, not a pass', () => {
    expect(checkRasterizer('gpu2', true, RTX)).toContain('unknown');
  });

  it('SOFTWARE_RENDERER names the known software renderers', () => {
    for (const s of ['llvmpipe (LLVM 15)', 'Microsoft Basic Render Driver', SWIFTSHADER, 'Software Rasterizer']) {
      expect(SOFTWARE_RENDERER.test(s)).toBe(true);
    }
    expect(SOFTWARE_RENDERER.test(RTX)).toBe(false);
  });
});
