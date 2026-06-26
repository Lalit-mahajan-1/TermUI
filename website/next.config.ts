import type { NextConfig } from 'next'
import path from 'path'
import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

// Turbopack resolveAlias needs RELATIVE specifiers (absolute paths get mangled
// to "./Users/..."); webpack aliases take absolute paths fine.
const TP_EMPTY = './src/lib/empty.js'
const TP_EMPTY_CHILD = './src/lib/empty-child-process.ts'
const EMPTY = path.resolve(__dirname, 'src/lib/empty.js')
const EMPTY_CHILD = path.resolve(__dirname, 'src/lib/empty-child-process.ts')

// Node built-ins the @termuijs packages reference (via `import * as X`) but that
// have no browser meaning. `path` gets a real browser impl because @termuijs/ui
// calls path.basename/join at module scope; the rest are inert stubs — the few
// widgets that actually call into them (FilePicker, readline prompts) can't run
// in a browser anyway, but stubbing keeps the shared bundle from breaking.
// Stubs are scoped to the `browser` condition so Next's own server code keeps
// the real built-ins. Turbopack ignores webpack's resolve.fallback, so each
// specifier needs an explicit alias here; bare AND node:-prefixed forms appear.
// Inert stubs (member access → undefined). Only used by code paths that can't
// run in a browser anyway. `fs` and `readline` get dedicated stubs because
// @termuijs/ui statically accesses named members Turbopack validates.
const STUB_MODULES = ['os', 'net', 'tls', 'crypto', 'stream', 'zlib', 'http', 'https']
const TP_FS = './src/lib/empty-fs.js'
const TP_READLINE = './src/lib/empty-readline.js'
const FS = path.resolve(__dirname, 'src/lib/empty-fs.js')
const READLINE = path.resolve(__dirname, 'src/lib/empty-readline.js')
const tpStub = Object.fromEntries(
  STUB_MODULES.flatMap((m) => [
    [m, { browser: TP_EMPTY }],
    [`node:${m}`, { browser: TP_EMPTY }],
  ]),
)

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      child_process: { browser: TP_EMPTY_CHILD },
      'node:child_process': { browser: TP_EMPTY_CHILD },
      '@termuijs/dev-server': { browser: TP_EMPTY },
      path: { browser: 'path-browserify' },
      'node:path': { browser: 'path-browserify' },
      fs: { browser: TP_FS },
      'node:fs': { browser: TP_FS },
      readline: { browser: TP_READLINE },
      'node:readline': { browser: TP_READLINE },
      ...tpStub,
    },
  },
  webpack(cfg, { isServer }) {
    if (!isServer) {
      cfg.resolve.fallback = {
        ...cfg.resolve.fallback,
        buffer: 'buffer/',
        string_decoder: 'string_decoder',
        events: 'events/',
        path: 'path-browserify',
        fs: FS,
        readline: READLINE,
        child_process: false,
        ...Object.fromEntries(STUB_MODULES.map((m) => [m, false])),
      }
      cfg.resolve.alias = {
        ...cfg.resolve.alias,
        'node:buffer': 'buffer/',
        'node:string_decoder': 'string_decoder',
        'node:events': 'events/',
        'node:path': 'path-browserify',
        'node:fs': FS,
        'node:readline': READLINE,
        'node:child_process': EMPTY_CHILD,
        '@termuijs/dev-server': EMPTY,
        ...Object.fromEntries(STUB_MODULES.map((m) => [`node:${m}`, EMPTY])),
      }
    }
    return cfg
  },
}

export default withMDX(config)
