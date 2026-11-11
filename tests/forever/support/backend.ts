// Which ANGLE backend a launched browser really got, for identity-vulkan.spec.ts (DI-67, DI-71). A pure function, so
// tests/unit/harness/backend.test.ts can hold it to real renderer strings.
//
// SwiftShader is itself a Vulkan implementation, and its ANGLE string names Vulkan: "ANGLE (Google, Vulkan 1.3.0
// (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" [T05's repair, O]. So /vulkan/ alone would label a
// software frame as Vulkan, and a software rasterizer is rejected first, with T00's own pattern.
import { SOFTWARE_RENDERER } from '../../support/rasterizer';

/** Starts every skip message, so B1's zero-skip rule can tell this DI-71 skip from an unarmed suite's UNARMED. */
export const NOT_VULKAN = 'NOT VULKAN (DI-71)';

/** Null when the renderer is ANGLE on a hardware Vulkan driver; otherwise why the print-only run must skip. */
export function notVulkanReason(webgl2: boolean, renderer: string): string | null {
  if (!webgl2) return `${NOT_VULKAN}: no WebGL2 context under --use-angle=vulkan`;
  if (SOFTWARE_RENDERER.test(renderer)) return `${NOT_VULKAN}: a software rasterizer, whose string may still name Vulkan: ${renderer}`;
  if (!/vulkan/i.test(renderer)) return `${NOT_VULKAN}: the launched renderer is not Vulkan: ${renderer}`;
  return null;
}
