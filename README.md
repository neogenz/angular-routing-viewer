# ngrv - Angular Routing Viewer

CLI that statically analyzes the routing of an Angular project (v17+) and generates a self-contained interactive graph at `<project>/angular-routing/index.html`.

## Installation

```bash
cd /path/to/angular-routing-viewer
bun install
```

## Usage

From the root of an Angular project:

```bash
bun /path/to/angular-routing-viewer/bin/ngrv.ts
```

Or via a global alias (after `bun link`):

```bash
bunx ngrv
```

Then open:

```bash
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
bunx ngrv                                 # analyze cwd
bunx ngrv ./my-app --open                 # analyze + open graph
bunx ngrv --entry src/app/app.routes.ts   # explicit entry
bunx ngrv --json > routes.json            # raw JSON export
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
