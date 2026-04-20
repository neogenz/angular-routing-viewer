# ngrv - Angular Routing Viewer

CLI that statically analyzes the routing of an Angular project (v17+) and generates a self-contained interactive graph at `<project>/angular-routing/index.html`.

## Installation

### Option A — Global (recommended)

Register `ngrv` as a global command via `bun link`. This reads the `bin` field in `package.json` and creates a symlink at `~/.bun/bin/ngrv`.

```bash
cd /path/to/angular-routing-viewer
bun install
bun link                 # run this INSIDE the package dir
```

Make sure `~/.bun/bin` is in your `$PATH` (Bun's installer normally adds it). Verify:

```bash
which ngrv               # → /Users/you/.bun/bin/ngrv
```

Then from any Angular project:

```bash
cd /path/to/angular-app
ngrv
```

To uninstall later: `cd /path/to/angular-routing-viewer && bun unlink`.

> Note: `bunx ngrv` will **not** work — the package isn't published on npm. Use `ngrv` directly after linking.

### Option B — Local (no global install)

```bash
cd /path/to/angular-routing-viewer
bun install
```

Then invoke via absolute path from any Angular project:

```bash
bun /path/to/angular-routing-viewer/bin/ngrv.ts
```

## Usage

Once installed (Option A), from the root of any Angular project:

```bash
ngrv                     # analyze cwd, write to ./angular-routing/
open angular-routing/index.html
```

## Options

| Option | Description |
|--------|-------------|
| `[path]` | Angular project path to analyze (default: cwd) |
| `--output <dir>` | Output directory (default: `./angular-routing`) |
| `--entry <file>` | Explicit root routes file (default: auto-detected) |
| `--project <name>` | Project name in a multi-app workspace |
| `--open` | Open the graph in the browser after generation |
| `--json` | Write data.json only to stdout (no HTML) |
| `--verbose` | Print analyzed files and full warnings |
| `--help, -h` | Show help |

## Examples

```bash
ngrv                                 # analyze cwd
ngrv ./my-app --open                 # analyze + open graph
ngrv --entry src/app/app.routes.ts   # explicit entry
ngrv --json > routes.json            # raw JSON export
```

## Graph interactions

- **Drag empty canvas**: pan
- **Drag node**: move
- **Click node**: full details in side panel
- **Hover**: branch highlight
- **Search** (top bar): filter by path / component / guard
- **Export JSON**: download data.json

## Node types

| Type | Color | Meaning |
|------|-------|---------|
| `route` | blue | Standard route with component |
| `lazy-module` | purple | `loadChildren` (lazy sub-routing) |
| `lazy-component` | cyan | `loadComponent` (lazy component) |
| `redirect` | orange | `redirectTo` |
| `wildcard` | gray | path `**` |

## Limitations

- Static analysis only (no code evaluation).
- Routes injected dynamically through non-standard providers may not be detected.
- `canLoad` guards are shown but flagged as deprecated (use `canMatch` instead).
