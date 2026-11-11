// Module boundaries (architecture.md section 3.2) and the plan's M4 table. Not type-aware, so a sibling's
// half-written file cannot break another task's lint. tests/boundaries/boundaries.test.ts proves each row.
import tseslint from 'typescript-eslint';

const MODULES = ['world', 'sim', 'feel', 'audio', 'ui', 'input', 'harness', 'app', 'testing', 'render'];
const RENDER_DIRS = ['terrain', 'sky', 'props', 'fx'];

const ENUM = { selector: 'TSEnumDeclaration', message: 'Use an `as const` object, not enum (Agents.md).' };
const CLOCK = { regex: '^three$', importNames: ['Clock'], message: 'THREE.Clock is banned: deprecated, and it warns at construction (section 3.3).' };

const THREE_RE = '^three(?:/|$)';
const POST_RE = '^postprocessing(?:/|$)';

// A specifier that resolves but is not the plain spelling: a/../b, a/./b, a//b, a\b, or a package reached by its path.
// The module regexes read a specifier as text, so each of these would walk round them.
const NON_CANONICAL = {
  regex: '(?:^|/)(?!\\.\\.?/)[^/]+/\\.\\./|/\\./|//|\\\\|(?:^|/)node_modules/',
  message: 'Write the plain path: no a/../b, a/./b, a//b, backslash or node_modules/ in a specifier (section 3.2).',
};

// The gate reads a specifier as text, so a dynamic import or glob it cannot read would pass whatever it reaches.
const UNREADABLE_DYNAMIC = {
  selector: 'ImportExpression[source.type!="Literal"]',
  message: 'A dynamic import takes a plain string literal, so the module boundary gate can read it (section 3.2).',
};
const IMPORT_GLOB = {
  selector: 'CallExpression[callee.object.type="MetaProperty"][callee.property.name="glob"]',
  message: 'import.meta.glob hides what it reaches from the module boundary gate (section 3.2).',
};

function projectRegex(names) {
  const n = names.join('|');
  return `^(?:\\./)?(?:\\.\\./)+(?:${n})(?:/|$)|(?:^|/)src/(?:${n})(?:/|$)`;
}

// esquery ends a regex at the first '/', and has no escape for it, so a slash is written as \x2F.
// The i flag matches no-restricted-imports, which ignores case by default: paths resolve case-insensitively here.
function esqueryRegex(regex) {
  return `/${regex.replaceAll('/', '\\x2F')}/i`;
}

function dynamicBan(regex, what) {
  return { selector: `ImportExpression[source.value=${esqueryRegex(regex)}]`, message: `Dynamic import of ${what} crosses a module boundary (section 3.2).` };
}

// typeof import('x') and import('x').T. no-restricted-imports does not see them, and tsc resolves them.
// `source`, not `argument`: reading `argument` prints a deprecation warning for every node in typescript-eslint 8.72.
function typeBan(regex, what) {
  return { selector: `TSImportType[source.value=${esqueryRegex(regex)}]`, message: `Type import of ${what} crosses a module boundary (section 3.2).` };
}

/**
 * One row of the M4 table.
 * forbid: project module names for static and type-position imports, and dynamic ones too unless dynamicForbid replaces it.
 * three: 'yes' | 'no' | 'type'. post: boolean. pure: bans the clocks and Math.random. extraPatterns, extraDynamic: added verbatim.
 */
function row(files, { forbid = [], dynamicForbid = forbid, three = 'yes', post = true, pure = false, extraPatterns = [], extraDynamic = [] }) {
  const patterns = [NON_CANONICAL, ...extraPatterns];
  const syntax = [
    ENUM, UNREADABLE_DYNAMIC, IMPORT_GLOB,
    dynamicBan(NON_CANONICAL.regex, 'a non-canonical path'), typeBan(NON_CANONICAL.regex, 'a non-canonical path'),
    ...extraDynamic.map((re) => dynamicBan(re, 'a module the shipped app may not reach')),
    ...extraPatterns.map((p) => typeBan(p.regex, 'a module the shipped app may not reach')),
  ];
  if (forbid.length > 0) {
    patterns.push({ regex: projectRegex(forbid), message: 'Module boundary: import through src/contracts (section 3.2).' });
    syntax.push(typeBan(projectRegex(forbid), 'a sibling module'));
  }
  if (dynamicForbid.length > 0) syntax.push(dynamicBan(projectRegex(dynamicForbid), 'a sibling module'));
  if (three === 'no') {
    patterns.push({ regex: THREE_RE, message: 'This module may not import three (section 3.2).' });
    syntax.push(dynamicBan(THREE_RE, 'three'), typeBan(THREE_RE, 'three'));
  } else if (three === 'type') {
    // Type position is what contracts may use, so only the dynamic form is banned here.
    patterns.push({ regex: THREE_RE, allowTypeImports: true, message: 'Contracts may import three for types only (section 8).' });
    syntax.push(dynamicBan(THREE_RE, 'three'));
  } else {
    patterns.push(CLOCK);
  }
  if (!post) {
    patterns.push({ regex: POST_RE, message: 'This module may not import postprocessing (section 3.2).' });
    syntax.push(dynamicBan(POST_RE, 'postprocessing'), typeBan(POST_RE, 'postprocessing'));
  }
  const rules = {
    '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
    'no-restricted-syntax': ['error', ...syntax],
  };
  if (pure) {
    rules['no-restricted-properties'] = ['error',
      { object: 'Math', property: 'random', message: 'Pure modules take randomness from hash01.' },
      { object: 'Date', property: 'now', message: 'Pure modules read no clock.' },
      { object: 'performance', property: 'now', message: 'Pure modules read no clock.' },
      ...['globalThis', 'window', 'self'].flatMap((object) => ['Math', 'Date', 'performance'].map((property) => (
        { object, property, message: 'Pure modules do not reach Math or a clock through the global object.' }
      ))),
    ];
  }
  return { files, rules };
}

const others = (...self) => MODULES.filter((m) => !self.includes(m));

const moduleRows = [
  row(['src/contracts/**'], { forbid: [...MODULES, 'core'], three: 'type', post: false }),
  row(['src/core/**'], { forbid: MODULES, three: 'no', post: false, pure: true }),
  ...['world', 'sim', 'feel'].map((m) => row([`src/${m}/**`], { forbid: others(m), three: 'no', post: false, pure: true })),
  ...['audio', 'ui', 'input'].map((m) => row([`src/${m}/**`], { forbid: others(m), three: 'no', post: false })),
  row(['src/harness/**'], { forbid: others('harness'), three: 'yes', post: false }),
  ...RENDER_DIRS.map((x) => {
    const siblings = RENDER_DIRS.filter((d) => d !== x);
    return row([`src/render/${x}/**`], {
      forbid: [...others('render'), ...siblings, ...siblings.map((d) => `render/${d}`)],
    });
  }),
  row(['src/testing/**'], { forbid: MODULES.filter((m) => m !== 'testing') }),
  row(['src/testing/fakeWorld.ts', 'src/testing/scriptedFrame.ts'], {
    forbid: MODULES.filter((m) => m !== 'testing'), three: 'no', post: false, pure: true,
  }),
  // A static import of the harness is the one way a normal visit would fetch it (C-30), so only a dynamic import may reach it.
  row(['src/app/**'], { forbid: ['testing', 'harness'], dynamicForbid: ['testing'] }),
  row(['src/main.ts'], {
    forbid: ['testing', 'harness'],
    dynamicForbid: ['testing'],
    extraPatterns: [{ regex: '^\\./(?:testing|harness)(?:/|$)', message: 'The shipped app may not statically import testing or harness (section 3.2).' }],
    extraDynamic: ['^\\./testing(?:/|$)'],
  }),
];

// tests/unit/<m> may not import the implementations of another module. testing, contracts and core are allowed.
const unitImplementations = MODULES.filter((m) => m !== 'testing');
const testRows = [
  ...['world', 'sim', 'feel', 'audio', 'ui', 'input', 'harness'].map((m) =>
    row([`tests/unit/${m}/**`], { forbid: unitImplementations.filter((n) => n !== m) })),
  ...RENDER_DIRS.map((x) => {
    const siblings = RENDER_DIRS.filter((d) => d !== x);
    return row([`tests/unit/${x}/**`], {
      forbid: [...unitImplementations.filter((n) => n !== 'render'), ...siblings, ...siblings.map((d) => `render/${d}`)],
    });
  }),
];

export default tseslint.config(
  {
    ignores: [
      '.claude/**', 'dist/**', 'node_modules/**', 'test-results/**', 'test-refs/**', 'playwright-report/**',
      'tests/boundaries/fixtures/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Agents.md: a[i]! is the hot-path idiom under noUncheckedIndexedAccess.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [CLOCK] }],
      'no-restricted-syntax': ['error', ENUM],
    },
  },
  ...moduleRows,
  ...testRows,
);
