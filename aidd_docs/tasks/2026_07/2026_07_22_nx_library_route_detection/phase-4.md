---
status: done
---

# Instruction: Prove end-to-end behavior and enforce it in CI

## Architecture projection

> Tree of the final files. ✅ create · ✏️ modify · ❌ delete

```txt
.
├── .github
│   └── workflows/ci.yml                              ✏️ run the analyzer test suite before build smoke tests
├── README.md                                         ✏️ document Nx usage, supported static forms, and runtime limits
├── CLAUDE.md                                         ✏️ record workspace and symbol-aware routing invariants
├── tsconfig.json                                     ✏️ typecheck test code while excluding text-only fixtures
└── tests
    ├── integration
    │   └── nx-workspace.test.ts                      ✅ exercise discovery, entry finding, and graph construction together
    └── fixtures
        └── angular-workspace
            ├── angular.json                          ✅ describe a classic Angular CLI application
            ├── package.json                          ✅ provide its Angular version
            ├── tsconfig.json                         ✅ provide its compiler context
            └── src/app/app-routing.module.ts         ✅ preserve classic root routing behavior
```

No files are deleted in this phase.

## Tasks to do

### 1) Assert the complete Nx route graph

> Verify the public analyzer pipeline against a realistic multi-app, multi-lib workspace.

1. Run project resolution, entry discovery, and graph construction against the checked-in Nx fixture.
2. Assert the selected project, workspace-relative entry, exact route hierarchy, source files, resolved lazy files, and warning set.
3. Prove that the other application is absent from the graph.
4. Keep timestamps and generated IDs out of broad snapshots; assert stable observable fields directly.

### 2) Protect legacy behavior

> Ensure Nx support does not regress classic Angular CLI and NgModule projects.

1. Exercise `angular.json`, inherited tsconfig data, `app-routing.module.ts`, `Routes`, redirects, inline children, and existing lazy/default export handling.
2. Retain tests for unresolved static constructs and warning levels.

### 3) Make the suite mandatory and document the boundary

> Turn the new compatibility matrix into a maintained project contract.

1. Include test sources in typechecking while excluding fixture TypeScript from compilation.
2. Add `bun run test` to CI alongside typecheck, Node bundle build, and bundle smoke checks.
3. Document Nx project selection, library route support, supported expression shapes, and runtime-only limitations.
4. Update architecture guidance with the shared ts-morph project, file-plus-export identity, recursion-stack rule, and workspace-root path semantics.

## Test acceptance criteria

| Task | Acceptance criteria |
| ---- | ------------------- |
| 1 | The public pipeline selects `admin` and returns the expected nested app-and-library graph without routes from `store` and without unresolved-route warnings. |
| 2 | The Angular CLI fixture retains its complete root and nested graph through `app-routing.module.ts`. |
| 3 | CI fails for a resolver or parser regression and passes the test, typecheck, build, and Node bundle smoke stages on the supported fixtures. |
| 3 | README claims match the tested static compatibility matrix and explicitly exclude runtime-computed and federated routes. |
