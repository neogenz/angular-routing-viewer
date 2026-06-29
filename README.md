# ngrv — Angular Routing Viewer

[![npm](https://img.shields.io/npm/v/angular-routing-viewer.svg)](https://www.npmjs.com/package/angular-routing-viewer)
[![CI](https://github.com/neogenz/angular-routing-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/neogenz/angular-routing-viewer/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/angular-routing-viewer.svg)](LICENSE)

Statically analyze any Angular (v17+) app's routing and get a **self-contained interactive graph** — no runtime, no server, no CDN. One HTML file you can open or commit.

```bash
npx angular-routing-viewer --open
```

- **Zero-config** — auto-detects `angular.json`, the right project, and your route entry files.
- **Deep static analysis** — follows `loadChildren` / `loadComponent`, resolves path constants (`ROUTES.WELCOME`), barrel re-exports, and tsconfig path aliases.
- **Self-contained output** — one `index.html` with all CSS/JS inlined. Drag, pan, search, inspect.
- **Runs on plain Node** — no Bun required to use it.

---

## Install

### Run it now, no install (recommended)

If you have Node (every Angular dev does), run it straight from npm:

```bash
npx angular-routing-viewer            # analyze the current Angular project
```

### Install globally

For a short, repeatable `ngrv` command:

```bash
npm install -g angular-routing-viewer
ngrv                                  # now available everywhere
```

Upgrade with `npm update -g angular-routing-viewer`, remove with `npm uninstall -g angular-routing-viewer`.

> The published package is named `angular-routing-viewer`; the command it installs is `ngrv`.

### From source (Bun)

For contributors or to run the latest `main`. Requires [Bun](https://bun.sh) ≥ 1.0.

```bash
git clone https://github.com/neogenz/angular-routing-viewer.git
cd angular-routing-viewer
bun install
bun run bin/ngrv.ts /path/to/angular-app    # run directly, no build needed
```

To expose a global `ngrv` from your checkout, build the bundle first (the `bin` points at `dist/`), then link it:

```bash
bun run build && bun link
```

---

## Usage

From the root of any Angular project:

```bash
ngrv                 # analyze cwd → ./angular-routing/index.html
ngrv --open          # ...and open it in the browser
```

### Options

| Option | Description |
|--------|-------------|
| `[path]` | Angular project path to analyze (default: cwd) |
| `--output <dir>` | Output directory (default: `./angular-routing`) |
| `--entry <file>` | Explicit root routes file (default: auto-detected) |
| `--project <name>` | Project name in a multi-app workspace |
| `--open` | Open the graph in the browser after generation |
| `--json` | Write `data.json` only to stdout (no HTML) |
| `--verbose` | Print analyzed files and full warnings |
| `--help, -h` | Show help |

### Examples

```bash
ngrv ./my-app --open                 # analyze a path + open the graph
ngrv --entry src/app/app.routes.ts   # force the entry file
ngrv --project admin                 # pick an app in a multi-app workspace
ngrv --json > routes.json            # raw JSON export, no HTML
```

---

## The graph

| Action | Result |
|--------|--------|
| Drag empty canvas | Pan |
| Drag node | Move |
| Click node | Full details in side panel |
| Hover node | Highlight its branch |
| Search (top bar) | Filter by path / component / guard |
| Export JSON | Download `data.json` |

**Node types**

| Type | Color | Meaning |
|------|-------|---------|
| `route` | blue | Standard route with a component |
| `lazy-module` | purple | `loadChildren` (lazy sub-routing) |
| `lazy-component` | cyan | `loadComponent` (lazy component) |
| `redirect` | orange | `redirectTo` |
| `wildcard` | gray | path `**` |

---

## Limitations

- Static analysis only — no code is evaluated, so routes injected through non-standard dynamic providers may be missed.
- `...(cond ? [...] : [])` spreads are flattened to the truthy branch (with a warning); non-ternary spreads are skipped.
- `canLoad` guards are shown but flagged deprecated — prefer `canMatch`.

---

## Development

```bash
bun install
bun run bin/ngrv.ts [path] [flags]   # run the CLI from source (no build step)
bun tsc --noEmit                     # typecheck
bun test                             # tests
bun run build                        # bundle to dist/ngrv.js (the published artifact)
```

The CLI is authored in TypeScript and runs directly under Bun in dev. For npm it's bundled to a single Node-runnable file at `dist/ngrv.js` via `scripts/build.ts` (`bun build --target node`, with `ts-morph` and `@clack/prompts` kept as external deps). End users run it under plain Node — no Bun needed.

To verify the published artifact locally:

```bash
bun run build
node dist/ngrv.js /path/to/angular-app --json   # exercise the bundle under Node
```

## Releasing

Publishing to npm is automated by `.github/workflows/release.yml` — pushing a `v*` tag builds the bundle and runs `npm publish`.

**Per release:**

1. Bump the version in **both** places so they agree:
   - `package.json` → `version` (what npm publishes)
   - `src/index.ts` → `const VERSION` (what `ngrv --help` prints)

   `npm version <patch|minor|major>` bumps `package.json` and creates the matching git tag in one step — just remember to update `src/index.ts` too.
2. Push the tag:
   ```bash
   git push --follow-tags
   ```
3. The workflow then builds `dist/ngrv.js` and publishes to npm with provenance.

Users get the new version automatically the next time they `npx angular-routing-viewer`, or via `npm update -g angular-routing-viewer`.

**One-time setup:** add an npm [automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens) as the repo secret `NPM_TOKEN`:

```bash
gh secret set NPM_TOKEN --repo neogenz/angular-routing-viewer
```

Or skip CI entirely and publish from your machine: `npm version patch && npm publish` (the `prepublishOnly` hook builds the bundle first; you must be `npm login`'d).

---

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the pre-PR checks. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, follow the [Security Policy](SECURITY.md).

## License

[MIT](LICENSE) © Maxime De Sogus
