// The structural view of T00's shell and fake world, because src/render/props may not import src/testing under T00's lint
// rules. dev/props.html hands the real ones to bootPropsDev. Never imported by the layer.
import type {
  DebugMode, Ev, FeelState, HeroMode, LayerName, PostStack, RenderContext, RenderLayer, SimState, Tier, Travel, WorldSource, ZoneState,
} from '../../../contracts/index';
import type { PropsDebug } from '../layer';
import type { SheetApi } from './sheet';
import type { SheetWorld } from './sheetWorld';

export interface ScriptedEventLike { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
export interface FrameOptions {
  at?: Travel; tick?: number; palette?: number; biome?: number; hero?: HeroMode;
  bend?: { a: number; c: number }; feel?: Partial<FeelState>; sim?: Partial<SimState>;
  tier?: Tier; reducedMotion?: boolean; events?: readonly ScriptedEventLike[]; world?: WorldSource;
  camX?: number; camY?: number;
  zone?: Partial<Pick<ZoneState, 'index' | 'biomeA' | 'biomeB' | 'biomeMix' | 'heroA' | 'heroB' | 'heroMix' | 'dayPhase'>>;
}
export interface ShellLike {
  readonly ready: boolean;
  readonly ctx: RenderContext;
  readonly shaderErrors: readonly string[];
  readonly warpSerial: number;
  setManual(on: boolean): void;
  frameAt(t: number, o?: FrameOptions): number;
  pixels(): Uint8Array;
  stats(): { calls: number; triangles: number; programs: number; geometries: number; textures: number; width: number; height: number };
  rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number };
  setTier(t: Tier): void;
  setLayerVisible(name: LayerName, on: boolean): void;
  setDebugMode(m: DebugMode): void;
  rebuild(): void;
  dispose(): void;
}
export interface FakeWorldOptionsLike { seed?: number; periodChunks?: number; archetypes?: readonly number[]; items?: readonly number[] }
export interface BootDeps {
  startDevShell(layers: RenderLayer[], post?: PostStack, o?: { world?: WorldSource; tier?: Tier }): ShellLike;
  createFakeWorld(o?: FakeWorldOptionsLike): WorldSource;
}

export interface BackdropControls {
  setFloor(on: boolean): void;
  setSky(on: boolean): void;
}

export interface PropsPage {
  readonly shell: ShellLike;
  /** null only under ?props=0. */
  readonly layer: (RenderLayer & { readonly debug?: PropsDebug }) | null;
  readonly debug: PropsDebug | null;
  readonly backdrop: RenderLayer & BackdropControls;
  readonly world: WorldSource;
  /** The mutable world under scene=one and scene=sheet. */
  readonly sheetWorld: SheetWorld | null;
  readonly metrics: typeof import('./metrics');
  /** The camera's projection of a render-space point to canvas pixels, y down, from the latest frame. */
  project(x: number, y: number, z: number): [number, number];
}

declare global {
  interface Window {
    __props?: PropsPage;
    __sheet?: SheetApi;
  }
}
