# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-29

### Added

- Initial release: static analysis of Angular (v17+) routing into a
  self-contained interactive HTML graph.
- Auto-detection of `angular.json`, the target project, and route entry files.
- Resolution of `loadChildren` / `loadComponent`, path constants, barrel
  re-exports, and tsconfig path aliases.
- CLI flags: `--output`, `--entry`, `--project`, `--open`, `--json`,
  `--verbose`, `--help`.
- Distribution via npm; runs under plain Node (Bun is dev-only).

[Unreleased]: https://github.com/neogenz/angular-routing-viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/neogenz/angular-routing-viewer/releases/tag/v0.1.0
