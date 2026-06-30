# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                          # install deps
bun run bin/ngrv.ts [path] [flags]   # run the CLI directly (no build step)
bun tsc --noEmit                     # typecheck (no emit, noEmit is enforced in tsconfig)
bun test                             # run tests (NO_COLOR=1 prefix recommended for deterministic output)
```

Run the CLI against a real Angular app for end-to-end smoke testing:
```bash
bun run bin/ngrv.ts /path/to/angular-app --verbose
```

There is no build for development: Bun runs `.ts` directly via the `#!/usr/bin/env bun` shebang in `bin/ngrv.ts`. The published artifact is different — see below.

## Release / distribution

Shipped to users via **npm** (`npx angular-routing-viewer`, or `npm i -g` for the `ngrv` command). End users run it under plain **Node** — Bun is dev-only.

The published bin is `dist/ngrv.js`, produced by `scripts/build.ts` (`bun run build`): `bun build --target node` bundles `bin/ngrv.ts`, keeping `ts-morph` and `@clack/prompts` external (npm installs them), then rewrites the entry shebang from `bun` to `node`. `dist/` is gitignored; `prepublishOnly` rebuilds it at publish time. Only `dist/` is published (`files` field).

The code must stay Node-compatible — no `Bun.*` runtime APIs (the two that existed, `Bun.argv` and `Bun.spawn`, were ported to `process.argv` and `node:child_process`).

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the bundle and runs `npm publish` via npm Trusted Publishing (OIDC — no token; needs `id-token: write`, already set, and the repo/workflow registered as a Trusted Publisher on npmjs). On every release bump **both** `package.json` `version` (what npm publishes) and `src/index.ts` `VERSION` (what `ngrv --help` prints). Full process: README "Releasing".

## Pipeline architecture

Three strict stages orchestrated by `src/index.ts → run()`:

1. **`resolveAngularProject`** (`src/analyzer/project-resolver.ts`)
   Walks up from the target path to find `angular.json`, picks the right project (by name / defaultProject / first), resolves the `tsconfig.app.json` via its `extends` chain, and **pre-resolves** `compilerOptions.paths` to absolute paths against `baseUrl` (this pre-resolution is load-bearing — downstream code assumes `tsconfigPaths.paths[k][i]` is already absolute). A custom JSONC stripper handles angular.json's glob patterns like `**/*.ts` which defeat naive regex approaches.

2. **`buildRouteGraph`** (`src/analyzer/route-parser.ts`)
   Single shared `ts-morph` `Project` instance threaded through every parse call. This is critical: constant resolution (`ROUTES.WELCOME` → `'welcome'`) calls `project.addSourceFileAtPathIfExists` on-the-fly to follow imports. If you ever introduce a second Project, symbol resolution breaks silently.

3. **`renderViewerHtml`** (`src/generator/html-builder.ts`)
   Computes layout (`computeLayout` in `layout.ts`, two-pass tidy tree: post-order subtree width + pre-order centered placement), then delegates to `buildHtml` in `templates/viewer.html.ts` which returns one self-contained HTML string with all CSS and JS inlined. No CDN, no framework.

## Non-obvious gotchas

**Routes array discovery order** (`findRoutesArray` in `route-parser.ts`):
1. `export default [...]` / `export default xxx satisfies Routes` / `export default identifier`
2. `export const xxx: Routes = [...]` (type-annotated variable)
3. Barrel re-export chain: `export { default } from './foo'` is followed via `findDefaultReExport` + `resolveImportSpecifier` (one-level recursion into target file).

Real-world Angular apps use all four forms across their `*.routes.ts` files — test new parsing changes against each.

**Spread handling**: `...(isDevMode() ? [...] : [])` is flattened to the truthy branch only, with an info-level warning. Non-ternary spreads are skipped with a warn-level warning.

**Constant resolution** (`resolveToStringLiteral` in `route-parser.ts`): for `path: ROUTES.WELCOME` and `title: PAGE_TITLES.X`, the parser follows the identifier's import declaration, loads the target file into the ts-morph project, and reads the object literal's key. If resolution fails, it falls back to the source text (e.g. `ROUTES.UNKNOWN`), and a secondary heuristic downstream strips the object prefix and kebab-cases it.

**Cycle detection**: the `visited: Map<filePath, RouteNode[]>` is set to `[]` *before* parsing starts, so re-entry detects the cycle and emits a warning rather than looping. Don't inline this — the empty-array-as-sentinel matters.

**Lazy resolution order** in `resolveImportSpecifier`: tsconfig path aliases (`@core/*`) → relative (`./foo`) → baseUrl-relative. Extensions tried in order: `""`, `.ts`, `.routes.ts`, `/index.ts`.

## HTML template conventions

`templates/viewer.html.ts` embeds JS as a **plain concatenated string** (single quotes + `+`), not template literals. This is deliberate — `${}` inside a TS template literal that contains JS is a footgun. Keep new JS additions in the same style.

`window.__GRAPH__` and `window.__LAYOUT__` are the two entry points the inline JS reads. Both are JSON injected into `<script>` with `</script>` sanitization. Any new runtime state should piggyback on these rather than adding new globals.

Node type colors are defined in TWO places and must stay in sync: the `<aside class="legend">` inline styles in the HTML, and the `typeConfig` map in the inline JS. Changing one without the other breaks the legend.

## Language

CLI output and UI labels are **English** (user overrode the initial French brief). Code identifiers are English. Comments are minimal. Warnings emitted by the analyzer are English too.
