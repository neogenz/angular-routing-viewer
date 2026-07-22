import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouteGraph } from "../../src/analyzer/route-parser.js";
import { resolveAngularProject } from "../../src/analyzer/project-resolver.js";
import type { RouteGraph, RouteNode } from "../../src/analyzer/types.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const nxWorkspace = join(fixturesRoot, "nx-workspace");
const adminRoutes = join(
  nxWorkspace,
  "apps/admin/src/app/app.routes.ts",
);
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
const legacyRoutingModule = join(
  nxWorkspace,
  "libs/legacy-orders/src/lib/legacy-orders-routing.module.ts",
);

async function buildAdminGraph(): Promise<RouteGraph> {
  const info = await resolveAngularProject(nxWorkspace, "admin");
  return buildRouteGraph(adminRoutes, info);
}

function findRoute(nodes: RouteNode[], fullPath: string): RouteNode | undefined {
  for (const node of nodes) {
    if (node.fullPath === fullPath) return node;
    const descendant = findRoute(node.children, fullPath);
    if (descendant) return descendant;
  }
  return undefined;
}

describe("composed route arrays", () => {
  test("resolves Route[] spreads and imported children across Nx libraries", async () => {
    const graph = await buildAdminGraph();

    expect(findRoute(graph.roots, "/orders/list")?.sourceFile).toBe(
      ordersRoutes,
    );
    expect(findRoute(graph.roots, "/orders/:id")?.sourceFile).toBe(
      orderDetailRoutes,
    );
    expect(findRoute(graph.roots, "/orders/:id/history")).toMatchObject({
      path: "history",
      sourceFile: sharedDetailRoutes,
    });
    expect(findRoute(graph.roots, "/orders/readonly")).toMatchObject({
      path: "readonly",
      sourceFile: sharedDetailRoutes,
    });
    expect(findRoute(graph.roots, "/orders/draft/summary")).toMatchObject({
      path: "summary",
      sourceFile: sharedDetailRoutes,
    });
  });

  test("follows a lazy NgModule to RouterModule.forChild routes", async () => {
    const graph = await buildAdminGraph();

    expect(findRoute(graph.roots, "/legacy/archive")).toMatchObject({
      path: "archive",
      sourceFile: legacyRoutingModule,
    });
  });

  test("warns instead of inventing routes for an arbitrary runtime loader", async () => {
    const graph = await buildAdminGraph();
    const runtimeRoute = findRoute(graph.roots, "/runtime");
    const warning = graph.warnings.find(({ message }) =>
      message.includes("Unable to statically resolve loadChildren"),
    );

    expect(runtimeRoute?.children).toEqual([]);
    expect(warning).toMatchObject({
      level: "warn",
      file: adminRoutes,
    });
    expect(warning?.line).toBeNumber();
  });
});
