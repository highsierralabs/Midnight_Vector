// DI-113, DI-115 and DI-116: a gate opens out of the frame once the ship's tail has passed its front face, and each member is thinned
// as it opens so none is magnified. The depth is the ship's own (SHIP_FORWARD, or the sheet's debug depth) less SHIP_HALF_LENGTH, never
// a literal. DI-118 removed the gate's legs (the operator's fix at T11's review), and with them DI-115's leg rule and this file's
// seat and pin checks; the gate mesh is now checked to have no leg.
//
// The shader cannot run here, so this file runs its text. The stretch of props.vert.glsl's main() from the gate rule to the opening
// (the first statement after it is the RING floor cut) is translated statement by statement into JavaScript and applied to buildGate's
// own mesh, and the geometry is checked on what comes out. The translator knows only the statement forms that stretch uses; anything
// else fails the test, so an edit there is either run or refused, never skipped. Outside the stretch, every statement that names the
// gate's variables is pinned (the tripwire).
//
// DI-116 replaced DI-115's version, which checked a TypeScript copy of the rule and pinned the shader to it by nine regular
// expressions: those pinned statements' text but not their order, their guards or anything added, and an edit to the copy alone went
// unseen (the DI-115 review). MUTANTS lists the regressions that review named, and more, each with the check expected to catch it.
// One edit is equivalent and is not caught: dropping the opening's own M_GATE guard, since gateK is exactly 1 for every other motion.
//
// What this does not show: the GPU runs float32 and its compiler may reorder or fuse; this runs float64 in the source's own order.
import { Mesh, PerspectiveCamera, Scene, ShaderMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { SHIP_FORWARD, type RenderContext } from '../../../src/contracts/index';
import { createSharedUniforms } from '../../../src/core/uniforms';
import { MeshBuilder, type BuiltMesh } from '../../../src/render/props/builders';
import vertSource from '../../../src/render/props/glsl/props.vert.glsl?raw';
import { ITEM_DEFS } from '../../../src/render/props/items';
import { createPropsLayer } from '../../../src/render/props/layer';
import { SHIP_HALF_LENGTH } from '../../../src/render/props/ship';
import { createFakeWorld } from '../../../src/testing/fakeWorld';

function gateOpenValues(root: Object3D): Set<unknown> {
  const out = new Set<unknown>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats: unknown[] = Array.isArray(o.material) ? o.material : [o.material];
    // T13: the cockpit has its own program, which is no prop and reads no gate depth.
    for (const m of mats) if (m instanceof ShaderMaterial && m.name !== 'props-cockpit') out.add(m.uniforms['uGateOpen']?.value);
  });
  return out;
}

/** The shader with its comments stripped and every run of white space one space. */
function norm(glsl: string): string {
  return glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
}

// ---- The translator -------------------------------------------------------------------------------------------------------------

type Kind = 'float' | 'vec3' | 'vec4';
interface V3 { x: number; y: number; z: number }
interface V4 { x: number; y: number; z: number; w: number }
interface Env {
  part: number; zf: number; uGateOpen: number; uMotion: number; M_GATE: number; uUseYaw: number; s: number; pin: number;
  l: V3; origin: V3; cameraPosition: V3; aInstB: V4;
}
interface Out { gateK: number; edgeK: V4; p: V3 }

/** What the stretch reads, as main() has set it up by then (pin = param for a gate, line 'else if (uMotion == M_GATE ...'). */
const INPUTS: Readonly<Record<string, Kind>> = {
  part: 'float', zf: 'float', uGateOpen: 'float', uMotion: 'float', M_GATE: 'float', uUseYaw: 'float', s: 'float', pin: 'float',
  l: 'vec3', origin: 'vec3', cameraPosition: 'vec3', aInstB: 'vec4',
};
const START = 'float gateK = 1.;';
const END = 'if (uLook == L_RING';
const FUNCS: Readonly<Record<string, string>> = { sign: 'Math.sign', cos: 'Math.cos', sin: 'Math.sin', smoothstep: 'smoothstep$' };
const MADE = new Set(['Math.hypot', ...Object.values(FUNCS)]);

function fail(why: string): never {
  throw new Error(`segment: ${why}`);
}

/** The index of the parenthesis closing the one at i. */
function closing(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Split at the commas outside any parentheses. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** `if (cond) rest`, or null. */
function splitIf(st: string): { cond: string; rest: string } | null {
  if (!st.startsWith('if (')) return null;
  const j = closing(st, 3);
  if (j < 0) fail(`unbalanced "${st}"`);
  return { cond: st.slice(4, j), rest: st.slice(j + 1).trim() };
}

/** One operand: a name, a number or a parenthesised group. Compound assignments take the whole right side, this does not. */
function primary(e: string): boolean {
  return /^[\w.]+$/.test(e) || (e.startsWith('(') && closing(e, 0) === e.length - 1);
}

function expr(e: string, kinds: ReadonlyMap<string, Kind>): string {
  if (!/^[\w\s.+\-*/()<>=!&|?:,]*$/.test(e) || !balanced(e)) fail(`cannot read "${e}"`);
  let out = e.replace(/\blength\((\w+)(\.xy)?\)/g, (_all, v: string, xy: string | undefined) => {
    if (kinds.get(v) !== 'vec3') fail(`length of "${v}"`);
    return xy ? `Math.hypot(${v}.x, ${v}.y)` : `Math.hypot(${v}.x, ${v}.y, ${v}.z)`;
  });
  out = out.replace(/\b(sign|cos|sin|smoothstep)\(/g, (_all, f: string) => `${FUNCS[f]}(`);
  for (const m of out.matchAll(/(?<![\w.$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    const name = m[0];
    if (MADE.has(name)) continue;
    const [base, ...rest] = name.split('.');
    const kind = kinds.get(base!);
    if (rest.length === 0 && kind === 'float') continue;
    if (rest.length === 1 && ((kind === 'vec3' && /^[xyz]$/.test(rest[0]!)) || (kind === 'vec4' && /^[xyzw]$/.test(rest[0]!)))) continue;
    fail(`"${name}" in "${e}" is not a float, one component of a vector, or a function this translator knows`);
  }
  return out;
}

function vec4(text: string, kinds: ReadonlyMap<string, Kind>): string {
  if (!text.startsWith('vec4(') || closing(text, 4) !== text.length - 1) fail(`not a vec4 constructor: "${text}"`);
  const a = args(text.slice(5, -1)).map((e) => expr(e, kinds));
  if (a.length === 1) return `((t$) => ({ x: t$, y: t$, z: t$, w: t$ }))(${a[0]})`;
  if (a.length === 4) return `{ x: ${a[0]}, y: ${a[1]}, z: ${a[2]}, w: ${a[3]} }`;
  return fail(`vec4 of ${a.length}: "${text}"`);
}

function statement(st: string, kinds: Map<string, Kind>): string {
  const head = splitIf(st);
  if (head) {
    if (head.rest === '') fail(`empty if: "${st}"`);
    return `if (${expr(head.cond, kinds)}) { ${statement(head.rest, kinds)} }`;
  }
  let m: RegExpExecArray | null;
  if ((m = /^const float (\w+) = (\d*\.\d*)$/.exec(st))) {
    kinds.set(m[1]!, 'float');
    return `const ${m[1]} = ${m[2]};`;
  }
  if ((m = /^float (.+)$/.exec(st))) {
    const decls = args(m[1]!).map((d) => {
      const q = /^(\w+) = (.+)$/.exec(d) ?? fail(`declaration "${d}"`);
      const e = expr(q[2]!, kinds);
      kinds.set(q[1]!, 'float');
      return `${q[1]} = ${e}`;
    });
    return `let ${decls.join(', ')};`;
  }
  if ((m = /^vec4 (\w+) = (vec4\(.*\))$/.exec(st))) {
    const e = vec4(m[2]!, kinds);
    kinds.set(m[1]!, 'vec4');
    return `let ${m[1]} = ${e};`;
  }
  if ((m = /^vec3 (\w+) = (\w+) \+ (\w+)$/.exec(st)) && kinds.get(m[2]!) === 'vec3' && kinds.get(m[3]!) === 'vec3') {
    kinds.set(m[1]!, 'vec3');
    return `let ${m[1]} = { x: ${m[2]}.x + ${m[3]}.x, y: ${m[2]}.y + ${m[3]}.y, z: ${m[2]}.z + ${m[3]}.z };`;
  }
  if ((m = /^(\w+) = (vec4\(.*\))$/.exec(st)) && kinds.get(m[1]!) === 'vec4') return `${m[1]} = ${vec4(m[2]!, kinds)};`;
  if ((m = /^(\w+) = vec3\((.*)\)$/.exec(st)) && kinds.get(m[1]!) === 'vec3' && closing(st, st.indexOf('(')) === st.length - 1) {
    const a = args(m[2]!).map((e) => expr(e, kinds));
    if (a.length !== 3) fail(`vec3 of ${a.length}: "${st}"`);
    return `${m[1]} = { x: ${a[0]}, y: ${a[1]}, z: ${a[2]} };`;
  }
  if ((m = /^(\w+) (=|\+=|-=|\*=|\/=) (.+)$/.exec(st)) && kinds.get(m[1]!) === 'float') return `${m[1]} ${m[2]} ${expr(m[3]!, kinds)};`;
  if ((m = /^(\w+) \*= (.+)$/.exec(st)) && kinds.get(m[1]!) === 'vec3') {
    return `{ const t$ = ${expr(m[2]!, kinds)}; ${m[1]}.x *= t$; ${m[1]}.y *= t$; ${m[1]}.z *= t$; }`;
  }
  if ((m = /^(\w+)\.([xyz]) (=|\+=|-=|\*=|\/=) (.+)$/.exec(st)) && kinds.get(m[1]!) === 'vec3') {
    return `${m[1]}.${m[2]} ${m[3]} ${expr(m[4]!, kinds)};`;
  }
  if ((m = /^(\w+)\.xy \*= (.+)$/.exec(st)) && kinds.get(m[1]!) === 'vec3') {
    return `{ const t$ = ${expr(m[2]!, kinds)}; ${m[1]}.x *= t$; ${m[1]}.y *= t$; }`;
  }
  m = /^(\w+)\.xy \+= \((\w+)\.xy - (\w+)\.xy\) \* (.+)$/.exec(st);
  if (m && [m[1]!, m[2]!, m[3]!].every((v) => kinds.get(v) === 'vec3') && primary(m[4]!)) {
    const [, a, b, c, e] = m;
    return `{ const t$ = ${expr(e!, kinds)}; const dx$ = ${b}.x - ${c}.x, dy$ = ${b}.y - ${c}.y; ${a}.x += dx$ * t$; ${a}.y += dy$ * t$; }`;
  }
  return fail(`no translation for "${st};"`);
}

/** The text split at its statement and block delimiters, outside parentheses. */
function pieces(text: string): { text: string; end: string }[] {
  const out: { text: string; end: string }[] = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) { out.push({ text: cur.trim(), end: ch }); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '') out.push({ text: cur.trim(), end: '' });
  return out;
}

function split(n: string): { before: string; body: string; after: string } {
  const a = n.indexOf(START), b = n.indexOf(END);
  if (a < 0 || b < a || n.indexOf(START, a + 1) >= 0) fail(`no single stretch from "${START}" to "${END}" in main()`);
  return { before: n.slice(0, a), body: n.slice(a, b), after: n.slice(b) };
}

function translate(body: string): string {
  const kinds = new Map<string, Kind>(Object.entries(INPUTS));
  const js: string[] = [];
  for (const { text, end } of pieces(body)) {
    if (end === '}') {
      if (text !== '') fail(`"${text}" before a closing brace`);
      js.push('}');
    } else if (end === '{') {
      if (text === 'else' || text === '') { js.push(`${text} {`); continue; }
      const head = splitIf(text.replace(/^else /, ''));
      if (!head || head.rest !== '') fail(`no translation for the block "${text} {"`);
      js.push(`${text.startsWith('else ') ? 'else ' : ''}if (${expr(head.cond, kinds)}) {`);
    } else if (end === ';') js.push(statement(text, kinds));
    else fail(`trailing "${text}"`);
  }
  return js.join('\n');
}

/** The shader's stretch as a function. GLSL's smoothstep, by its definition in the GLSL ES 3.00 spec. */
function compile(src: string): (env: Env) => Out {
  const js = translate(split(norm(src)).body);
  const body = [
    '"use strict";',
    'const smoothstep$ = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };',
    'let { part, zf, uGateOpen, uMotion, M_GATE, uUseYaw, s, pin } = env$;',
    'let l = { ...env$.l }, origin = { ...env$.origin }, cameraPosition = { ...env$.cameraPosition }, aInstB = { ...env$.aInstB };',
    js,
    'return { gateK, edgeK, p };',
  ].join('\n');
  return new Function('env$', body) as (env: Env) => Out;
}

// ---- The mesh and the scene -----------------------------------------------------------------------------------------------------

function gateMesh(): BuiltMesh {
  const def = ITEM_DEFS.find((d) => d.name === 'GATE');
  if (!def) throw new Error('no GATE in ITEM_DEFS');
  const b = new MeshBuilder();
  def.build(b);
  return b.finish();
}

interface Vert { i: number; x: number; y: number; z: number; part: number; param: number }
const MESH = gateMesh();
const VERTS: readonly Vert[] = Array.from({ length: MESH.position.length / 3 }, (_, i) => ({
  i, x: MESH.position[i * 3]!, y: MESH.position[i * 3 + 1]!, z: MESH.position[i * 3 + 2]!, part: MESH.tag[i * 2]!, param: MESH.tag[i * 2 + 1]!,
}));
const key = (v: Vert): string => `${v.x.toFixed(5)},${v.y.toFixed(5)}`;
const INNER = 1 / Math.cos(Math.PI / 8);

/** The mid-line the rule thins toward, from the mesh: the mean ring radius. */
const MIDS = (() => {
  let rMin = Infinity, rMax = -Infinity;
  for (const v of VERTS) {
    if (v.part > 0.5) continue;
    rMin = Math.min(rMin, Math.hypot(v.x, v.y)); rMax = Math.max(rMax, Math.hypot(v.x, v.y));
  }
  return { GATE_MID: (rMin + rMax) / 2 };
})();

const M_GATE = 7, M_OTHER = 8;
const OPEN = SHIP_FORWARD - SHIP_HALF_LENGTH;
const GATE = { x: -0.677, y: 8, r: 9 };                       // seed 1985's gate at chunk 3102, as probe3 used
const CAMERAS: readonly { x: number; y: number }[] = [
  { x: GATE.x, y: 7 },                                        // the harness height, on the gate's centre line
  { x: GATE.x + 7.5, y: 5.6 },                                // probe3's setup B: low and near a side
  { x: GATE.x - 3, y: 7 },
];
const DEPTHS = [50, 12, OPEN, 11.5, 10.4, 9.6, 8.8, 7.6, 6.5, 6, 3, -5];

interface Drawn { v: Vert; p: V3; gateK: number; edgeK: V4 }

function draw(run: (env: Env) => Out, cam: { x: number; y: number }, zf: number, uMotion = M_GATE, uGateOpen = OPEN): Drawn[] {
  return VERTS.map((v) => ({
    v,
    ...run({
      part: v.part, zf, uGateOpen, uMotion, M_GATE, uUseYaw: 0, s: GATE.r, pin: uMotion === M_GATE ? v.param : 0,
      l: { x: v.x, y: v.y, z: v.z }, origin: { x: GATE.x, y: GATE.y, z: -zf }, cameraPosition: { x: cam.x, y: cam.y, z: 0 },
      aInstB: { x: 0.3, y: GATE.r, z: 0, w: 0.5 },
    }),
  }));
}

// ---- The checks -------------------------------------------------------------------------------------------------------------------

const TRIPWIRE = /\b(M_GATE|gateK|gateU|edgeK|GATE_MID|SIDE_MID)\b/;   // SIDE_MID: DI-115's leg constant, gone with the legs
/** Every statement outside the stretch that names the gate's variables: the pin, the outline's edge factor, and the flash. */
const OUTSIDE = ['else if (uMotion == M_GATE || uMotion == M_SPIKE)', 'vEdge = aEdge * edgeScale * edgeK', 'if (uMotion == M_GATE)'];

/** What is wrong with a version of props.vert.glsl's gate rule, each problem led by the name of the check that found it. */
function gateProblems(src: string): string[] {
  const out: string[] = [];
  const once = new Set<string>();
  const report = (what: string, msg: string): void => {
    if (once.has(what)) return;
    once.add(what);
    out.push(msg);
  };
  const n = norm(src);

  for (const [name, want] of Object.entries(MIDS)) {
    const m = new RegExp(`const float ${name} = ([0-9.]+);`).exec(n);
    if (!m) report(name, `mesh: no const float ${name}`);
    else if (Math.abs(Number(m[1]) - want) > 1e-6) report(name, `mesh: ${name} is ${m[1]}, buildGate's is ${want.toFixed(7)}`);
  }
  if (/\b11\.8\b/.test(n)) report('literal', 'depth: a literal 11.8 in the shader');

  let parts: ReturnType<typeof split>;
  let run: (env: Env) => Out;
  try {
    parts = split(n);
    run = compile(src);
  } catch (e) {
    out.push((e as Error).message);
    return out;
  }
  const outside = pieces(`${parts.before} ${parts.after}`).map((p) => p.text);
  const hits = outside.filter((t) => TRIPWIRE.test(t));
  if (JSON.stringify(hits) !== JSON.stringify(OUTSIDE)) report('tripwire', `tripwire: outside the rule the gate's names are in ${JSON.stringify(hits)}`);
  if (!n.includes('else if (uMotion == M_GATE || uMotion == M_SPIKE) { pin = param; }')) report('pin', 'tripwire: a gate vertex is no longer pinned by its param');
  if (!outside.includes('vEdge = aEdge * edgeScale * edgeK')) report('vEdge', 'edge: vEdge no longer takes edgeK');

  try {
    // Exactly the identity while the ring is closed, and for every other motion: the position main() had before DI-110, bit for bit.
    const closedCases: [number, number][] = [[50, M_GATE], [12, M_GATE], [OPEN, M_GATE], [50, M_OTHER], [6, M_OTHER], [3, M_OTHER], [-5, M_OTHER]];
    for (const cam of CAMERAS) {
      for (const [zf, motion] of closedCases) {
        for (const { v, p, gateK, edgeK } of draw(run, cam, zf, motion)) {
          const pin = motion === M_GATE ? v.param : 0;
          const want = { x: GATE.x + v.x * GATE.r, y: pin > 0.5 ? 0 : GATE.y + v.y * GATE.r, z: -zf + v.z * GATE.r };
          const same = Object.is(p.x, want.x) && Object.is(p.y, want.y) && Object.is(p.z, want.z) && gateK === 1
            && edgeK.x === 1 && edgeK.y === 1 && edgeK.z === 1 && edgeK.w === 1;
          if (!same) report(`id${motion}`, `identity: ${motion === M_GATE ? 'a closed gate' : 'another motion'} at zf ${zf} is not drawn as before (vertex ${v.i}, gateK ${gateK})`);
        }
      }
    }

    // The ring opens with the ship's tail: 1 at or past uGateOpen, rising to 7 at 5.8 u nearer, whatever uGateOpen is.
    for (const open of [OPEN, 30]) {
      const k = (zf: number): number => draw(run, CAMERAS[0]!, zf, M_GATE, open)[0]!.gateK;
      let last = 1;
      for (let zf = open + 1; zf >= open - 7; zf -= 0.05) {
        const g = k(zf);
        if (g < last - 1e-12) report('mono', `depth: gateK falls from ${last} to ${g} at zf ${zf.toFixed(2)}`);
        if ((zf >= open && g !== 1) || (zf <= open - 5.8 - 1e-9 && g !== 7)) report(`ends${open}`, `depth: gateK ${g} at zf ${zf.toFixed(2)} with uGateOpen ${open}`);
        last = g;
      }
      if (!(k(open - 1) > 1)) report(`starts${open}`, `depth: the ring is still closed 1 u inside uGateOpen ${open}`);
    }

    for (const [c, cam] of CAMERAS.entries()) {
      const closed = draw(run, cam, 50);
      for (const zf of DEPTHS) {
        const d = draw(run, cam, zf);
        const k = d[0]!.gateK;
        if (k === 1) continue;
        const at = `k ${k.toFixed(3)}, camera ${c}`;
        // Every front panel is 4 vertices, inner i, outer i, outer i + 1, inner i + 1: its two seams keep their world length.
        for (const [a] of d.entries()) {
          if (d[a]!.v.part > 0.5 || a % 4 !== 0) continue;
          for (const [i, j] of [[a, a + 1], [a + 3, a + 2]] as const) {
            const was = Math.hypot(closed[j]!.p.x - closed[i]!.p.x, closed[j]!.p.y - closed[i]!.p.y);
            const now = Math.hypot(d[j]!.p.x - d[i]!.p.x, d[j]!.p.y - d[i]!.p.y);
            if (Math.abs(now - was) > 1e-9) report('width', `width: a member's band ${was.toFixed(4)} u becomes ${now.toFixed(4)} u (${at})`);
          }
        }
        // The inner band stays joined to the front panels.
        const front = new Map(d.filter((x) => x.v.part < 0.5).map((x) => [key(x.v), x.p]));
        for (const { v, p } of d) {
          if (v.part < 0.5 || v.part > 1.5) continue;
          const f = front.get(key(v));
          if (!f || Math.hypot(p.x - f.x, p.y - f.y) > 1e-9) report('joined', `joined: the inner band comes away from the front at vertex ${v.i} (${at})`);
        }
        // The opening is about the camera's line: the ring's centre moves away from it by k.
        const corners = new Map(d.filter((x) => x.v.part < 0.5 && Math.abs(Math.hypot(x.v.x, x.v.y) - INNER) < 1e-5).map((x) => [key(x.v), x.p]));
        const cx = [...corners.values()].reduce((t, p) => t + p.x, 0) / corners.size;
        const cy = [...corners.values()].reduce((t, p) => t + p.y, 0) / corners.size;
        if (Math.hypot(cx - (cam.x + k * (GATE.x - cam.x)), cy - (cam.y + k * (GATE.y - cam.y))) > 1e-5) report('axis', `axis: the ring does not open about the camera's line (${at})`);
        // Front panel seams open with the ring; nothing else's edges change.
        for (const { v, edgeK } of d) {
          const want = v.part < 0.5 ? [k, 1, k, 1] : [1, 1, 1, 1];
          if (![edgeK.x, edgeK.y, edgeK.z, edgeK.w].every((e, i) => e === want[i])) report('edgeK', `edge: part ${v.part} edgeK is (${edgeK.x}, ${edgeK.y}, ${edgeK.z}, ${edgeK.w}) (${at})`);
        }
      }
    }
  } catch (e) {
    out.push(`segment: it does not run: ${(e as Error).message}`);
  }
  return out;
}

/** DI-115's rule for the ring, written out on its own (DI-118: no legs): the shader must compute exactly this. */
function rule(v: Vert, cam: { x: number; y: number }, zf: number): V3 {
  const t = Math.min(Math.max((zf - (OPEN - 5.8)) / (OPEN - (OPEN - 5.8)), 0), 1);
  const k = 1 + 6 * (1 - t * t * (3 - 2 * t)), u = 1 - 1 / k;
  let x = v.x, y = v.y;
  if (v.part < 1.5) {
    const f = 1 - (1 - 1.1581597 / Math.hypot(x, y)) * u;
    x *= f; y *= f;
  }
  const p = { x: GATE.x + x * GATE.r, y: GATE.y + y * GATE.r, z: -zf + v.z * GATE.r };
  if (v.param > 0.5) p.y = 0;
  p.x += (p.x - cam.x) * (k - 1);
  p.y += (p.y - cam.y) * (k - 1);
  return p;
}

// ---- Mutants ----------------------------------------------------------------------------------------------------------------------

function swap(s: string, from: string, to: string): string {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`mutant: "${from}" occurs ${n} times`);
  return s.replace(from, () => to);
}
const OPENING = 'if (uMotion == M_GATE) p.xy += (p.xy - cameraPosition.xy) * (gateK - 1.);';
const MUTANTS: readonly { name: string; apply: (s: string) => string; want: string }[] = [
  { name: "the ring's thinning reaches the front panels only (part < .5)", apply: (s) => swap(s, 'if (part < 1.5) {', 'if (part < .5) {'), want: 'joined' },
  { name: 'the rule loses its M_GATE guard', apply: (s) => swap(s, 'if (uMotion == M_GATE) { gateK', '{ gateK'), want: 'identity' },
  { name: "edgeK's default is not 1", apply: (s) => swap(s, 'vec4 edgeK = vec4(1.);', 'vec4 edgeK = vec4(1., 1., 1., 0.);'), want: 'edge' },
  { name: 'an added statement halves the thinning', apply: (s) => swap(s, 'float gateU = 1. - 1. / gateK;', 'float gateU = 1. - 1. / gateK; gateU *= .5;'), want: 'width' },
  { name: 'an added statement scales the ring', apply: (s) => swap(s, 'uGateOpen, zf));', 'uGateOpen, zf)); l.xy *= 1.1;'), want: 'identity' },
  { name: 'the opening moves after the mirror flip', apply: (s) => swap(swap(s, `${OPENING} `, ''), 'p = bendV(p);', `${OPENING} p = bendV(p);`), want: 'tripwire' },
  { name: 'the opening moves after the bend', apply: (s) => swap(swap(s, `${OPENING} `, ''), 'p = bendV(p);', `p = bendV(p); ${OPENING}`), want: 'tripwire' },
  { name: 'a gate vertex is no longer pinned', apply: (s) => swap(s, 'else if (uMotion == M_GATE || uMotion == M_SPIKE) {', 'else if (uMotion == M_SPIKE) {'), want: 'tripwire' },
  { name: 'a new gate-only step after the rule', apply: (s) => swap(s, 'p = bendV(p);', 'if (uMotion == M_GATE) p.y *= 1.01; p = bendV(p);'), want: 'tripwire' },
  { name: 'the radius is taken in 3D, length(l)', apply: (s) => swap(s, 'length(l.xy)', 'length(l)'), want: 'joined' },
  { name: 'the depth ramp is reversed', apply: (s) => swap(s, 'smoothstep(uGateOpen - 5.8, uGateOpen, zf)', 'smoothstep(uGateOpen, uGateOpen - 5.8, zf)'), want: 'identity' },
  { name: 'a literal depth, as DI-110 had', apply: (s) => swap(s, 'smoothstep(uGateOpen - 5.8, uGateOpen, zf)', 'smoothstep(6., 11.8, zf)'), want: 'depth' },
  { name: 'the opening is not 0 at k 1', apply: (s) => swap(s, '* (gateK - 1.);', '* gateK;'), want: 'identity' },
  { name: 'the opening is about the gate, not the camera', apply: (s) => swap(s, '(p.xy - cameraPosition.xy)', '(p.xy - origin.xy)'), want: 'axis' },
  { name: 'GATE_MID is off the mean radius', apply: (s) => swap(s, 'const float GATE_MID = 1.1581597;', 'const float GATE_MID = 1.2;'), want: 'mesh' },
  { name: 'no thinning, so whole members are scaled (what DI-110 did)', apply: (s) => swap(s, 'float gateU = 1. - 1. / gateK;', 'float gateU = 0.;'), want: 'width' },
  { name: 'vEdge drops edgeK', apply: (s) => swap(s, 'vEdge = aEdge * edgeScale * edgeK;', 'vEdge = aEdge * edgeScale;'), want: 'edge' },
  { name: 'a statement the translator would misread (precedence)', apply: (s) => swap(s, '* (gateK - 1.);', '* gateK - 1.;'), want: 'segment' },
  { name: 'a construct the translator does not know', apply: (s) => swap(s, 'float gateU = 1. - 1. / gateK;', 'float gateU = 1. - 1. / gateK; l.xz *= .9;'), want: 'segment' },
];

// ---- Tests ------------------------------------------------------------------------------------------------------------------------

describe('DI-113, DI-115 and DI-116: a gate opening out of the frame', () => {
  it('starts at the ship tail depth on every prop material, and follows the sheet debug ship depth', () => {
    const scene = new Scene();
    const layer = createPropsLayer({ debug: true });
    // attach reads only world, shared and scene; no GL is touched until a render.
    const ctx = { renderer: null, scene, camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld() } as unknown as RenderContext;
    layer.attach(ctx);
    expect(gateOpenValues(scene)).toEqual(new Set([SHIP_FORWARD - SHIP_HALF_LENGTH]));
    layer.debug!.setShipForward(30);
    expect(gateOpenValues(scene)).toEqual(new Set([30 - SHIP_HALF_LENGTH]));
    layer.debug!.setShipForward(SHIP_FORWARD);
    expect(gateOpenValues(scene)).toEqual(new Set([SHIP_FORWARD - SHIP_HALF_LENGTH]));
  });

  it("runs the shader's own text, which computes exactly DI-115's ring rule", () => {
    const run = compile(vertSource);
    let worst = 0, n = 0;
    for (const cam of CAMERAS) {
      for (const zf of DEPTHS) {
        for (const { v, p } of draw(run, cam, zf)) {
          const q = rule(v, cam, zf);
          worst = Math.max(worst, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
          n++;
        }
      }
    }
    expect(n).toBe(VERTS.length * CAMERAS.length * DEPTHS.length);
    expect(worst).toBeLessThan(1e-12);
  });

  it("has every property the record claims, on buildGate's mesh", () => {
    // DI-118: the gate floats. No leg (part 2) and no vertex pinned to the floor, the operator's fix at T11's review (Q3).
    expect(VERTS.filter((v) => v.part > 1.5).length).toBe(0);
    expect(VERTS.filter((v) => v.param > 0.5).length).toBe(0);
    expect(gateProblems(vertSource)).toEqual([]);
  });

  it.each(MUTANTS)('catches a regression: $name', ({ apply, want }) => {
    const got = gateProblems(apply(norm(vertSource)));
    expect(got.some((p) => p.startsWith(`${want}:`)), got.join('\n') || 'no problem found').toBe(true);
  });
});
