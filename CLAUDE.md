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
   Delegates to `workspace-discovery.ts`, which walks upward for `angular.json` or `nx.json`. Angular CLI projects come from `angular.json`; Nx projects come from static `project.json` and `package.json#nx` metadata. Selection is explicit via `--project`, inferred from a target inside an app root, or accepted when only one application exists; ambiguous roots fail instead of choosing an arbitrary app. The resolver follows the selected tsconfig's `extends` chain and pre-resolves `compilerOptions.paths` to absolute paths against the declaring `baseUrl`. Downstream import resolution relies on those absolute targets.

2. **`buildRouteGraph`** (`src/analyzer/route-parser.ts`)
   Creates one shared `ts-morph` `Project` and passes it to `route-source-resolver.ts` and every parse call. The resolver maps aliases, relative imports, workspace package names, and `baseUrl` imports to files, then follows named/default/star exports through barrels. Route parsing composes imported arrays, spreads, `children`, lazy routes, and `RouterModule.forRoot` / `RouterModule.forChild`. Keep the shared Project: constant and export resolution add source files on demand.

3. **`renderViewerHtml`** (`src/generator/html-builder.ts`)
   Computes layout (`computeLayout` in `layout.ts`, two-pass tidy tree: post-order subtree width + pre-order centered placement), then delegates to `buildHtml` in `templates/viewer.html.ts` which returns one self-contained HTML string with all CSS and JS inlined. No CDN, no framework.

Before rendering or JSON output, `src/index.ts` rewrites entry, route source, lazy target, and warning file paths relative to `workspaceRoot`. Do not change these to project-root-relative paths: library routes may live outside the selected application's root.

## Non-obvious gotchas

**Routes array discovery order** (`findRoutesExpression` in `route-parser.ts`):
1. A requested named export when an import or lazy callback selects one.
2. `export default [...]`, including identifiers and `as` / `satisfies` wrappers.
3. Type-identified arrays using `Routes`, `Route[]`, and supported readonly variants.
4. NgModule metadata containing `RouterModule.forRoot(...)` or `RouterModule.forChild(...)`.

Barrel traversal belongs to `route-source-resolver.ts`. It follows named re-exports, aliases, and star exports recursively; do not reintroduce route-parser-only, one-level barrel handling.

**Spread handling**: direct local or imported route arrays are resolved recursively. `...(isDevMode() ? [...] : [])` is flattened to the truthy branch only, with an info-level warning. An unresolved spread gets a warn-level warning.

**Constant resolution** (`resolveToStringLiteral` in `route-parser.ts`): for `path: ROUTES.WELCOME` and `title: PAGE_TITLES.X`, the parser follows the identifier's import declaration, loads the target file into the ts-morph project, and reads the object literal's key. If resolution fails, it falls back to the source text (e.g. `ROUTES.UNKNOWN`), and a secondary heuristic downstream strips the object prefix and kebab-cases it.

**Source identity and cycles**: a route source is `(absolute file path, exported symbol)`, not only a file. Cycle checks use branch-local recursion stacks for route sources, route-array expressions, NgModules, and barrel exports. Do not replace them with a global `visited` map: the same library route array may be mounted under multiple parent paths and must produce a distinct subtree each time.

**Import resolution order** in `resolveImportSpecifier`: tsconfig path aliases (`@core/*`) → relative or absolute paths (`./foo`) → exact Nx workspace package names → `baseUrl`-relative. Extensions tried in order: `""`, `.ts`, `.routes.ts`, `/index.ts`. Export resolution is a separate step and must preserve the selected export name through barrels.

**Static boundary**: runtime-computed providers, plugin-only Nx project inference, Module Federation, and loaders without a statically visible import/export cannot be reconstructed. Preserve explicit warnings for unresolved imports, exports, spreads, loaders, and cycles; never present a partial branch as successfully resolved.

## HTML template conventions

`templates/viewer.html.ts` embeds JS as a **plain concatenated string** (single quotes + `+`), not template literals. This is deliberate — `${}` inside a TS template literal that contains JS is a footgun. Keep new JS additions in the same style.

`window.__GRAPH__` and `window.__LAYOUT__` are the two entry points the inline JS reads. Both are JSON injected into `<script>` with `</script>` sanitization. Any new runtime state should piggyback on these rather than adding new globals.

Node type colors are defined in TWO places and must stay in sync: the `<aside class="legend">` inline styles in the HTML, and the `typeConfig` map in the inline JS. Changing one without the other breaks the legend.

## Language

CLI output and UI labels are **English** (user overrode the initial French brief). Code identifiers are English. Comments are minimal. Warnings emitted by the analyzer are English too.
