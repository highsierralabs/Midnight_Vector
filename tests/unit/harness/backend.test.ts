import { describe, expect, it } from 'vitest';
import { NOT_VULKAN, notVulkanReason } from '../../forever/support/backend';

// Renderer strings read on this machine's RTX 4070 SUPER under Chromium 151 [O: R2 and R3 runs of identity-vulkan.spec.ts].
const VULKAN = 'ANGLE (NVIDIA, Vulkan 1.4.303 (NVIDIA NVIDIA GeForce RTX 4070 SUPER (0x00002783)), NVIDIA)';
const D3D11 = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 SUPER (0x00002783) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

describe('notVulkanReason (DI-71)', () => {
  it('passes ANGLE on a hardware Vulkan driver', () => {
    expect(notVulkanReason(true, VULKAN)).toBeNull();
  });

  it('skips D3D11, naming the renderer', () => {
    const why = notVulkanReason(true, D3D11);
    expect(why).toContain(NOT_VULKAN);
    expect(why).toContain('Direct3D11');
  });

  it('skips SwiftShader, though its string names Vulkan, so a software frame is never labelled Vulkan', () => {
    expect(/vulkan/i.test(SWIFTSHADER), 'the trap is real: a Vulkan-only check would pass it').toBe(true);
    const why = notVulkanReason(true, SWIFTSHADER);
    expect(why).toContain(NOT_VULKAN);
    expect(why).toContain('software rasterizer');
  });

  it('skips a launch with no WebGL2', () => {
    expect(notVulkanReason(false, '')).toContain('no WebGL2');
  });

  it('every reason starts with the marker B1 tells apart from UNARMED', () => {
    for (const why of [notVulkanReason(true, D3D11), notVulkanReason(true, SWIFTSHADER), notVulkanReason(false, '')]) {
      expect(why!.startsWith(NOT_VULKAN)).toBe(true);
      expect(why!.startsWith('UNARMED')).toBe(false);
    }
  });
});
