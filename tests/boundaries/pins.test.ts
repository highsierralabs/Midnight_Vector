import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Pkg { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }

const EXPECTED: Record<string, string> = {
  postprocessing: '6.39.6',
  three: '0.187.0',
  '@types/node': '24.19.2',
  '@types/three': '0.187.0',
  eslint: '10.14.0',
  playwright: '1.64.1',
  typescript: '6.0.3',
  'typescript-eslint': '8.72.1',
  vite: '8.3.5',
  vitest: '5.1.0',
};

/** Returns one message per broken rule. */
function checkPins(pkg: Pkg): string[] {
  const problems: string[] = [];
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, version] of Object.entries(all)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${name}: ${version} is not an exact version`);
    if (EXPECTED[name] === undefined) problems.push(`${name}: not a section 2 package`);
    else if (EXPECTED[name] !== version) problems.push(`${name}: ${version}, section 2 pins ${EXPECTED[name]}`);
  }
  for (const name of Object.keys(EXPECTED)) {
    if (all[name] === undefined) problems.push(`${name}: missing`);
  }
  const runtime = Object.keys(pkg.dependencies ?? {}).sort();
  if (runtime.join() !== 'postprocessing,three') problems.push(`dependencies must be exactly three and postprocessing, got ${runtime.join()}`);
  return problems;
}

/** Script names in the Commands section of Agents.md, plus the two named only in a comment. */
function agentsScripts(text: string): string[] {
  const names = new Set<string>();
  const start = text.indexOf('### Commands');
  const end = text.indexOf('### Source of truth');
  const commands = text.slice(start, end);
  for (const m of commands.matchAll(/npm run ([\w:]+)/g)) names.add(m[1]!);
  for (const m of commands.matchAll(/\b(test:\w+)\b/g)) names.add(m[1]!);
  if (/^npm test\b/m.test(commands)) names.add('test');
  return [...names].sort();
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg;

describe('package.json pins', () => {
  it('has exact versions, the section 2 set, and exactly two runtime dependencies', () => {
    expect(checkPins(pkg)).toEqual([]);
  });

  it('a mutated copy with ^ fails', () => {
    const bad: Pkg = { ...pkg, dependencies: { ...pkg.dependencies, three: '^0.187.0' } };
    expect(checkPins(bad).join('\n')).toContain('three: ^0.187.0 is not an exact version');
  });

  it('a mutated copy with ~ fails', () => {
    const bad: Pkg = { ...pkg, devDependencies: { ...pkg.devDependencies, vite: '~8.3.5' } };
    expect(checkPins(bad).join('\n')).toContain('vite: ~8.3.5 is not an exact version');
  });

  it('a third runtime dependency fails', () => {
    const bad: Pkg = { ...pkg, dependencies: { ...pkg.dependencies, 'simplex-noise': '4.0.3' } };
    expect(checkPins(bad).join('\n')).toContain('dependencies must be exactly three and postprocessing');
  });

  it('three moved to 0.188 fails', () => {
    const bad: Pkg = { ...pkg, dependencies: { ...pkg.dependencies, three: '0.188.0' } };
    expect(checkPins(bad).join('\n')).toContain('three: 0.188.0, section 2 pins 0.187.0');
  });
});

describe('script names', () => {
  const names = agentsScripts(readFileSync('Agents.md', 'utf8'));

  it('finds the names Agents.md gives', () => {
    expect(names).toEqual(expect.arrayContaining([
      'dev', 'build', 'preview', 'typecheck', 'lint', 'test', 'check', 'check:task', 'plans:check',
      'test:smoke', 'test:browser', 'test:forever', 'test:perf', 'test:art',
    ]));
  });

  it.each(agentsScripts(readFileSync('Agents.md', 'utf8')))('%s exists in package.json', (name) => {
    expect(pkg.scripts?.[name]).toBeDefined();
  });

  it('the plan\'s own script names exist', () => {
    for (const name of ['glsl:check', 'contracts:check', 'build:proof', 'test:foundation']) {
      expect(pkg.scripts?.[name]).toBeDefined();
    }
  });

  it('never runs a playwright install', () => {
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/playwright install/);
  });
});
