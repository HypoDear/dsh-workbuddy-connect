import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-workbuddy-connect'

/** Read the npm version once so the build injects it into src/version.ts. */
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

/** Build-time define map; `src/version.ts` reads `__DSH_WORKBUDDY_VERSION__`. */
const VERSION_DEFINE = { __DSH_WORKBUDDY_VERSION__: JSON.stringify(PACKAGE_VERSION) }

/**
 * Host-provided modules, kept external for the host-loaded entry. These are
 * peerDependencies the harness supplies in-process; inlining any of them would
 * give the running host a second copy of a singleton it already owns.
 */
const HOST_EXTERNALS = [
  '@earendil-works/pi-ai',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-settings',
] as const

/**
 * Modules the host loader provides, kept out of the browser bundle. The
 * client's DSH imports are type-only today — they erase at build time, so the
 * emitted bundle only requires React. The list is the guardrail that keeps a
 * future value import `require`d from the host instead of inlined.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale/client',
] as const

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    define: VERSION_DEFINE,
    deps: { neverBundle: [...HOST_EXTERNALS] },
  },
  {
    /*
     * The CLI is a *standalone process*, so it cannot borrow the host's copies
     * of anything: Node resolves its imports from this package's own directory,
     * where the host's packages are deliberately absent (see the README's
     * `pnpm install --prod` note), and it would fail at startup with
     * ERR_MODULE_NOT_FOUND. The two host packages its graph actually needs are
     * therefore inlined here rather than externalized.
     *
     * Inlining is safe for these two specifically because neither carries
     * process-wide state: `dsh-home-paths` only computes paths, and
     * `dsh-atomic-write`'s lock/rename behaviour is a filesystem convention, so
     * a copy of the same version interlocks with the host's copy exactly as the
     * host's own would. Nothing here is a cordis service or a pi-ai instance —
     * the duplication this plugin does guard against.
     *
     * Built as its OWN config, never sharing a chunk with `index`: a shared
     * chunk would drag these copies into the host-loaded bundle, which is
     * precisely the shadowing the externals list exists to prevent.
     */
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    define: VERSION_DEFINE,
    deps: {
      // tsdown externalizes `peerDependencies` by default, so inlining these two
      // has to be asked for explicitly rather than by omission.
      neverBundle: ['@earendil-works/pi-ai'],
      // ⚠️ `alwaysBundle` alone is NOT enough: tsdown only inlines a package it
      // can actually RESOLVE. This plugin installs with `--prod`, so
      // `@deepseek-ai/*` is absent from `node_modules` (that is the whole point
      // — see the README) and the bundler silently leaves a bare `import` in
      // lib/bin.js, which then dies at startup with ERR_MODULE_NOT_FOUND.
      //
      // Verified 2026-10-17: with node_modules/@deepseek-ai temporarily linked
      // to the host's copy, lib/bin.js goes 184,290 -> 194,648 bytes and gains
      // the inlined `withFileLock` implementation; without it the import stays
      // external and `dsh plugin --profile web exec ... doctor` fails.
      // Use `pnpm run build:cli`, which always establishes that link.
      alwaysBundle: ['@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-home-paths'],
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    define: VERSION_DEFINE,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
