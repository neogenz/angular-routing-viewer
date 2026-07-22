import { describe, expect, test } from "bun:test";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAngularProject } from "../../src/analyzer/project-resolver.js";
import { findRouteEntry } from "../../src/analyzer/route-finder.js";
import { buildRouteGraph } from "../../src/analyzer/route-parser.js";
import type { RouteNode } from "../../src/analyzer/types.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const nxWorkspace = join(fixturesRoot, "nx-workspace");
const angularWorkspace = join(fixturesRoot, "angular-workspace");

const adminRoutes = join(nxWorkspace, "apps/admin/src/app/app.routes.ts");
const storeRoot = join(nxWorkspace, "apps/store");
const ordersRoutes = join(
  nxWorkspace,
  "libs/orders/src/lib/orders.routes.ts",
);
const orderDetailRoutes = join(
  nxWorkspace,
  "libs/order-detail/src/lib/order-detail.routes.ts",
);
const sharedDetailRoutes = join(
  nxWorkspace,
  "libs/order-detail/src/lib/shared-detail.routes.ts",
);
const legacyOrdersModule = join(
  nxWorkspace,
  "libs/legacy-orders/src/lib/legacy-orders.module.ts",
);
const legacyOrdersRoutingModule = join(
  nxWorkspace,
  "libs/legacy-orders/src/lib/legacy-orders-routing.module.ts",
);

const legacyAppRoot = join(angularWorkspace, "projects/legacy-app");
const legacyRoutingModule = join(
  legacyAppRoot,
  "src/app/app-routing.module.ts",
);
const legacyReportRoutes = join(legacyAppRoot, "src/app/reports.routes.ts");

interface StableRoute {
  path: string;
  fullPath: string;
  type: RouteNode["type"];
  sourceFile: string;
  redirectTo?: string;
  pathMatch?: "full" | "prefix";
  loadChildren?: {
    source: string;
    resolvedFile?: string;
  };
  children: StableRoute[];
}

function stableRoute(node: RouteNode): StableRoute {
  return {
    path: node.path,
    fullPath: node.fullPath,
    type: node.type,
    sourceFile: node.sourceFile,
    ...(node.redirectTo === undefined ? {} : { redirectTo: node.redirectTo }),
    ...(node.pathMatch === undefined ? {} : { pathMatch: node.pathMatch }),
    ...(node.loadChildren === undefined
      ? {}
      : {
          loadChildren: {
            source: node.loadChildren.source,
            ...(node.loadChildren.resolvedFile === undefined
              ? {}
              : { resolvedFile: node.loadChildren.resolvedFile }),
          },
        }),
    children: node.children.map(stableRoute),
  };
}

function leaf(
  path: string,
  fullPath: string,
  sourceFile: string,
): StableRoute {
  return { path, fullPath, type: "route", sourceFile, children: [] };
}

function collectRoutes(nodes: RouteNode[]): RouteNode[] {
  return nodes.flatMap((node) => [node, ...collectRoutes(node.children)]);
}

describe("Nx workspace analyzer pipeline", () => {
  test("selects admin and builds the complete app-and-library route graph", async () => {
    const project = await resolveAngularProject(nxWorkspace, "admin");
    const entry = await findRouteEntry(project);
    const graph = await buildRouteGraph(entry, project);

    expect(project).toMatchObject({
      projectName: "admin",
      workspaceRoot: nxWorkspace,
      projectRoot: join(nxWorkspace, "apps/admin"),
      sourceRoot: join(nxWorkspace, "apps/admin/src"),
      tsconfigPath: join(nxWorkspace, "apps/admin/tsconfig.app.json"),
      angularVersion: "^21.0.0",
    });
    expect(relative(project.workspaceRoot, entry)).toBe(
      "apps/admin/src/app/app.routes.ts",
    );
    expect(graph.metadata).toMatchObject({
      projectName: "admin",
      angularVersion: "^21.0.0",
      entryFile: adminRoutes,
    });

    expect(graph.roots.map(stableRoute)).toEqual([
      {
        path: "orders",
        fullPath: "/orders",
        type: "lazy-module",
        sourceFile: adminRoutes,
        loadChildren: {
          source: "@acme/orders",
          resolvedFile: ordersRoutes,
        },
        children: [
          leaf("list", "/orders/list", ordersRoutes),
          {
            ...leaf(":id", "/orders/:id", orderDetailRoutes),
            children: [
              leaf("history", "/orders/:id/history", sharedDetailRoutes),
            ],
          },
          leaf("readonly", "/orders/readonly", sharedDetailRoutes),
          {
            ...leaf("draft", "/orders/draft", ordersRoutes),
            children: [
              leaf("summary", "/orders/draft/summary", sharedDetailRoutes),
            ],
          },
          {
            ...leaf("archived", "/orders/archived", ordersRoutes),
            children: [
              leaf(
                "summary",
                "/orders/archived/summary",
                sharedDetailRoutes,
              ),
            ],
          },
          {
            ...leaf("cycle-start", "/orders/cycle-start", sharedDetailRoutes),
            children: [
              leaf(
                "detail-cycle",
                "/orders/cycle-start/detail-cycle",
                orderDetailRoutes,
              ),
              leaf(
                "order-cycle-sibling",
                "/orders/cycle-start/order-cycle-sibling",
                orderDetailRoutes,
              ),
            ],
          },
          leaf(
            "shared-cycle-sibling",
            "/orders/shared-cycle-sibling",
            sharedDetailRoutes,
          ),
        ],
      },
      {
        path: "legacy",
        fullPath: "/legacy",
        type: "lazy-module",
        sourceFile: adminRoutes,
        loadChildren: {
          source: "@acme/legacy-orders",
          resolvedFile: legacyOrdersModule,
        },
        children: [
          leaf("archive", "/legacy/archive", legacyOrdersRoutingModule),
        ],
      },
      {
        path: "runtime",
        fullPath: "/runtime",
        type: "lazy-module",
        sourceFile: adminRoutes,
        loadChildren: { source: "() => loadRoutesAtRuntime()" },
        children: [],
      },
    ]);

    const analyzedFiles = collectRoutes(graph.roots).flatMap((route) => [
      route.sourceFile,
      route.loadChildren?.resolvedFile,
      route.loadComponent?.resolvedFile,
    ]).filter((file): file is string => file !== undefined);
    expect(analyzedFiles.some((file) => file.startsWith(storeRoot))).toBeFalse();
    expect(collectRoutes(graph.roots).some(({ fullPath }) =>
      fullPath.includes("store")
    )).toBeFalse();

    const resolutionRegressions = graph.warnings.filter(({ message }) =>
      /Unable to resolve (?:route import|export)|No Routes array or RouterModule routes found/.test(
        message,
      )
    );
    expect(resolutionRegressions).toEqual([]);

    const runtimeWarnings = graph.warnings.filter(({ message }) =>
      message.startsWith("Unable to statically resolve loadChildren"),
    );
    expect(runtimeWarnings).toHaveLength(1);
    expect(runtimeWarnings[0]).toMatchObject({
      level: "warn",
      message:
        "Unable to statically resolve loadChildren: () => loadRoutesAtRuntime()",
      file: adminRoutes,
    });
    expect(runtimeWarnings[0]?.line).toBeNumber();

    const cycleWarnings = graph.warnings.filter(({ message }) =>
      message.startsWith("Route source cycle detected"),
    );
    expect(cycleWarnings).toHaveLength(1);
    expect(cycleWarnings[0]).toMatchObject({
      level: "warn",
      file: sharedDetailRoutes,
    });
    expect(graph.warnings).toHaveLength(2);
  });
});

describe("Angular CLI analyzer regression", () => {
  test("keeps NgModule, redirects, inline children, and default lazy routes", async () => {
    const project = await resolveAngularProject(angularWorkspace);
    const entry = await findRouteEntry(project);
    const graph = await buildRouteGraph(entry, project);

    expect(project).toMatchObject({
      projectName: "legacy-app",
      workspaceRoot: angularWorkspace,
      projectRoot: legacyAppRoot,
      sourceRoot: join(legacyAppRoot, "src"),
      tsconfigPath: join(legacyAppRoot, "tsconfig.app.json"),
      angularVersion: "^21.0.0",
    });
    expect(project.tsconfigPaths.paths).toEqual({
      "@legacy/*": [join(angularWorkspace, "projects/legacy-lib/src/*")],
    });
    expect(relative(project.workspaceRoot, entry)).toBe(
      "projects/legacy-app/src/app/app-routing.module.ts",
    );
    expect(graph.metadata).toMatchObject({
      projectName: "legacy-app",
      angularVersion: "^21.0.0",
      entryFile: legacyRoutingModule,
    });

    expect(graph.roots.map(stableRoute)).toEqual([
      {
        path: "",
        fullPath: "/",
        type: "redirect",
        sourceFile: legacyRoutingModule,
        redirectTo: "dashboard",
        pathMatch: "full",
        children: [],
      },
      {
        ...leaf("dashboard", "/dashboard", legacyRoutingModule),
        children: [
          leaf("overview", "/dashboard/overview", legacyRoutingModule),
          leaf("settings", "/dashboard/settings", legacyRoutingModule),
        ],
      },
      {
        path: "reports",
        fullPath: "/reports",
        type: "lazy-module",
        sourceFile: legacyRoutingModule,
        loadChildren: {
          source: "./reports.routes",
          resolvedFile: legacyReportRoutes,
        },
        children: [
          leaf("monthly", "/reports/monthly", legacyReportRoutes),
          {
            ...leaf("archive", "/reports/archive", legacyReportRoutes),
            children: [
              leaf(":year", "/reports/archive/:year", legacyReportRoutes),
            ],
          },
        ],
      },
      {
        path: "**",
        fullPath: "/**",
        type: "wildcard",
        sourceFile: legacyRoutingModule,
        redirectTo: "dashboard",
        children: [],
      },
    ]);
    expect(graph.warnings).toEqual([]);
  });
});
