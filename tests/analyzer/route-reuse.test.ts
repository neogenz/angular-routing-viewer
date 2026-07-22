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
const sharedDetailRoutes = join(
  nxWorkspace,
  "libs/order-detail/src/lib/shared-detail.routes.ts",
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

describe("route fragment identity", () => {
  test("mounts one shared export below two parents with distinct nodes", async () => {
    const graph = await buildAdminGraph();
    const draftSummary = findRoute(graph.roots, "/orders/draft/summary");
    const archivedSummary = findRoute(
      graph.roots,
      "/orders/archived/summary",
    );

    expect(draftSummary).toMatchObject({ sourceFile: sharedDetailRoutes });
    expect(archivedSummary).toMatchObject({ sourceFile: sharedDetailRoutes });
    expect(draftSummary?.id).not.toBe(archivedSummary?.id);
  });

  test("stops a file-and-export cycle without suppressing siblings", async () => {
    const graph = await buildAdminGraph();
    const cycleWarnings = graph.warnings.filter(({ message }) =>
      message.toLowerCase().includes("cycle"),
    );

    expect(
      findRoute(graph.roots, "/orders/cycle-start/detail-cycle")?.children,
    ).toEqual([]);
    expect(
      findRoute(graph.roots, "/orders/cycle-start/order-cycle-sibling"),
    ).toBeDefined();
    expect(findRoute(graph.roots, "/orders/shared-cycle-sibling")).toBeDefined();
    expect(findRoute(graph.roots, "/orders/list")).toBeDefined();
    expect(cycleWarnings).toHaveLength(1);
    expect(cycleWarnings[0]).toMatchObject({
      level: "warn",
      file: sharedDetailRoutes,
    });
  });
});
