import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { resolveAngularProject } from "../../src/analyzer/project-resolver.js";
import { buildRouteGraph } from "../../src/analyzer/route-parser.js";
import {
  createRouteSourceResolver,
  extractLazyRouteImport,
} from "../../src/analyzer/route-source-resolver.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const nxWorkspace = join(fixturesRoot, "nx-workspace");
const adminRoutes = join(
  nxWorkspace,
  "apps/admin/src/app/app.routes.ts",
);
const ordersIndex = join(nxWorkspace, "libs/orders/src/index.ts");
const ordersRoutes = join(
  nxWorkspace,
  "libs/orders/src/lib/orders.routes.ts",
);
const orderDetailIndex = join(
  nxWorkspace,
  "libs/order-detail/src/index.ts",
);
const orderDetailRoutes = join(
  nxWorkspace,
  "libs/order-detail/src/lib/order-detail.routes.ts",
);

describe("route module resolution", () => {
  test("resolves exact aliases before the longest matching wildcard", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(await resolver.resolveImport("@acme/orders", adminRoutes)).toBe(
      ordersIndex,
    );
    expect(
      await resolver.resolveImport("@acme/routes/order-detail", adminRoutes),
    ).toBe(orderDetailIndex);
  });

  test("resolves relative, base-url, and directory index imports deterministically", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveImport("./lib/orders.routes", ordersIndex),
    ).toBe(ordersRoutes);
    expect(
      await resolver.resolveImport(
        "libs/orders/src/lib/orders.routes",
        adminRoutes,
      ),
    ).toBe(ordersRoutes);
    expect(await resolver.resolveImport("./barrels", ordersIndex)).toBe(
      join(nxWorkspace, "libs/orders/src/barrels/index.ts"),
    );
  });

  test("resolves a statically declared local Nx package entry point", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const orderDetail = info.workspaceProjects.find(
      ({ name }) => name === "order-detail",
    );
    expect(orderDetail).toBeDefined();

    const resolver = createRouteSourceResolver({
      ...info,
      workspaceProjects: info.workspaceProjects.map((project) =>
        project === orderDetail
          ? { ...project, packageName: "@acme/order-detail-package" }
          : project,
      ),
    });

    expect(
      await resolver.resolveImport("@acme/order-detail-package", adminRoutes),
    ).toBe(orderDetailIndex);
  });

  test("reports an unresolved specifier with its importing file", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveSource({
        specifier: "@acme/does-not-exist",
        fromFile: adminRoutes,
        exportName: "missingRoutes",
      }),
    ).toBeUndefined();
    expect(resolver.warnings).toHaveLength(1);
    expect(resolver.warnings[0]?.message).toContain("@acme/does-not-exist");
    expect(resolver.warnings[0]?.file).toBe(adminRoutes);
  });
});

describe("lazy route import selection", () => {
  test("extracts a selected .then export and treats a direct import as default", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/lazy.ts",
      [
        "const named = () => import('@acme/orders').then(module => module.ordersRoutes);",
        "const direct = () => import('@acme/orders');",
      ].join("\n"),
    );

    const named = extractLazyRouteImport(
      sourceFile.getVariableDeclarationOrThrow("named").getInitializerOrThrow(),
    );
    const direct = extractLazyRouteImport(
      sourceFile.getVariableDeclarationOrThrow("direct").getInitializerOrThrow(),
    );

    expect(named).toMatchObject({
      specifier: "@acme/orders",
      exportName: "ordersRoutes",
    });
    expect(direct).toMatchObject({
      specifier: "@acme/orders",
      exportName: "default",
    });
  });

  test("parses the selected lazy export instead of the first array in its file", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const graph = await buildRouteGraph(adminRoutes, info);

    expect(graph.roots[0]?.fullPath).toBe("/orders");
    expect(graph.roots[0]?.children.map(({ fullPath }) => fullPath)).toEqual([
      "/orders/list",
    ]);
  });
});

describe("export-aware route source resolution", () => {
  test("selects the requested named export instead of the first route array", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveSource({
        specifier: "@acme/orders",
        fromFile: adminRoutes,
        exportName: "ordersRoutes",
      }),
    ).toEqual({ filePath: ordersRoutes, exportName: "ordersRoutes" });
  });

  test("follows named aliases and star re-exports through barrels", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveSource({
        specifier: "@acme/orders-alias",
        fromFile: adminRoutes,
        exportName: "checkoutRoutes",
      }),
    ).toEqual({ filePath: ordersRoutes, exportName: "ordersRoutes" });
    expect(
      await resolver.resolveSource({
        specifier: "@acme/orders-star",
        fromFile: adminRoutes,
        exportName: "ordersRoutes",
      }),
    ).toEqual({ filePath: ordersRoutes, exportName: "ordersRoutes" });
    expect(
      await resolver.resolveSource({
        specifier: "@acme/routes/order-detail",
        fromFile: adminRoutes,
        exportName: "orderDetailRoutes",
      }),
    ).toEqual({
      filePath: orderDetailRoutes,
      exportName: "orderDetailRoutes",
    });
  });

  test("preserves a default export through a multi-level barrel", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveSource({
        specifier: "@acme/orders-default",
        fromFile: adminRoutes,
        exportName: "default",
      }),
    ).toEqual({ filePath: ordersRoutes, exportName: "default" });
  });

  test("terminates a barrel cycle with one warning", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");
    const resolver = createRouteSourceResolver(info);

    expect(
      await resolver.resolveSource({
        specifier: "@acme/orders-cycle",
        fromFile: adminRoutes,
        exportName: "missingRoutes",
      }),
    ).toBeUndefined();
    expect(resolver.warnings).toHaveLength(1);
    expect(resolver.warnings[0]?.message.toLowerCase()).toContain("cycle");
    expect(resolver.warnings[0]?.file).toContain("cycle-");
  });
});
