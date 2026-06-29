# Contributing

Thanks for your interest in improving ngrv. This is a small, focused tool — contributions that keep it simple and dependency-light are the most welcome.

## Development setup

Requires [Bun](https://bun.sh) ≥ 1.0.

```bash
git clone https://github.com/neogenz/angular-routing-viewer.git
cd angular-routing-viewer
bun install
```

Run the CLI from source against any Angular project:

```bash
bun run bin/ngrv.ts /path/to/angular-app --verbose
```

## Before opening a pull request

```bash
bun tsc --noEmit     # typecheck — must pass
bun run build        # the published Node bundle must build
bun test             # tests (if any)
```

CI runs the same checks on every pull request.

## Guidelines

- **Keep it Node-compatible.** The published binary runs under plain Node, not Bun. Do not introduce `Bun.*` runtime APIs in `src/` or `bin/` — use Node equivalents (`process.*`, `node:child_process`, `node:fs/promises`, …).
- **Keep dependencies minimal.** New runtime dependencies need a strong justification.
- **Test parser changes against real apps.** Angular projects express routes in several forms (`export default`, `export const x: Routes`, barrel re-exports, path constants). Verify your change against more than one real `*.routes.ts`.
- **Match the surrounding style.** See `CLAUDE.md` for architecture notes and non-obvious conventions (e.g. the HTML template is authored as concatenated strings on purpose).

## Reporting bugs

Open an issue with the Angular setup that reproduces it (route file shape, tsconfig path aliases, workspace layout) and the CLI output with `--verbose`. A minimal repro repo is the fastest path to a fix.
