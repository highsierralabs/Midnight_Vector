// src/contracts/glsl.ts
import common from './glsl/common.glsl?raw';
import commonFrag from './glsl/common.frag.glsl?raw';
import hero from './glsl/hero.glsl?raw';

export const COMMON_VERT = common;
export const COMMON_FRAG = common + commonFrag + hero;
