---
objective: "Angular Routing Viewer statically detects the complete route tree of a selected Angular application in Nx workspaces, including route fragments owned by libraries, with automated regression coverage."
status: in-progress
---

# Plan: Nx workspace and library route detection

## Overview

| Field      | Value |
| ---------- | ----- |
| **Goal**   | Resolve Angular routes across Nx applications, libraries, nested route fragments, and legacy Angular workspaces without executing application code. |
| **Source** | User request from 2026-07-22. |

## Phases

| #   | Phase | File |
| --- | ----- | ---- |
| 1 | Discover the selected Nx application | [`phase-1.md`](./phase-1.md) |
| 2 | Resolve route sources across library boundaries | [`phase-2.md`](./phase-2.md) |
| 3 | Compose nested routes without losing reuse or cycles | [`phase-3.md`](./phase-3.md) |
| 4 | Prove end-to-end behavior and enforce it in CI | [`phase-4.md`](./phase-4.md) |

## Resources

| Source | Verified |
| ------ | -------- |
| [Nx project configuration](https://nx.dev/docs/reference/project-configuration) | Nx project metadata can come from `project.json` or `package.json`, while targets can be inferred and need not contain a build target. |
| [Nx TypeScript project linking](https://nx.dev/docs/concepts/typescript-project-linking) | Workspace library aliases are commonly inherited from the root `tsconfig.base.json`, and a child `paths` property replaces rather than merges the parent property. |
| [Angular Route API](https://angular.dev/api/router/Route) | Nested route configuration can be supplied through `children` or `loadChildren`; custom async loaders remain possible. |
| [Angular RouterModule API](https://angular.dev/api/router/RouterModule) | NgModule-based feature routing registers child configurations through `RouterModule.forChild`. |

## Decisions

| Decision | Why |
| -------- | --- |
| Discover Nx projects from workspace files instead of invoking `nx` or application code. | Keeps analysis deterministic, offline, dependency-light, and compatible with the published Node binary. Fully plugin-inferred projects without usable static metadata will fail with an actionable message. |
| Identify a route source by absolute file and exported symbol, then keep cycle state separate from reusable parse state. | A barrel can expose several route arrays, and the same library fragment can legitimately be mounted below several parent paths. |
| Limit completeness guarantees to statically resolvable Angular route expressions. | Arbitrary loaders and Module Federation depend on runtime state; they must produce explicit warnings rather than silently incomplete graphs. |
