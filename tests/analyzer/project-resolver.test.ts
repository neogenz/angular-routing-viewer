import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAngularProject } from "../../src/analyzer/project-resolver.js";
import { discoverWorkspace } from "../../src/analyzer/workspace-discovery.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const angularWorkspace = join(fixturesRoot, "angular-workspace");
const nxWorkspace = join(fixturesRoot, "nx-workspace");

function portableRelative(from: string, to: string): string {
  const value = relative(from, to);
  return sep === "\\" ? value.split(sep).join("/") : value;
}

async function expectSelectionError(
  target: string,
  projectName?: string,
  validApplications = ["admin", "store"],
): Promise<void> {
  let captured: unknown;
  try {
    await resolveAngularProject(target, projectName);
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(Error);
  const message = (captured as Error).message;
  for (const application of validApplications) {
    expect(message).toContain(application);
  }
}

describe("Nx workspace discovery", () => {
  test("discovers project.json and package.json#nx applications", async () => {
    const workspace = await discoverWorkspace(
      join(nxWorkspace, "apps/admin/src/app"),
    );

    expect(workspace.kind).toBe("nx");
    expect(workspace.workspaceRoot).toBe(nxWorkspace);
    expect(workspace.configPath).toBe(join(nxWorkspace, "nx.json"));
    expect([...workspace.projects.keys()].sort()).toEqual(["admin", "store"]);

    expect(workspace.projects.get("admin")).toMatchObject({
      name: "admin",
      projectType: "application",
      root: join(nxWorkspace, "apps/admin"),
      sourceRoot: join(nxWorkspace, "apps/admin/src"),
      configPath: join(nxWorkspace, "apps/admin/project.json"),
      tsConfig: "apps/admin/tsconfig.app.json",
    });
    expect(workspace.projects.get("store")).toMatchObject({
      name: "store",
      packageName: "@fixture/store",
      projectType: "application",
      root: join(nxWorkspace, "apps/store"),
      sourceRoot: join(nxWorkspace, "apps/store/client"),
      configPath: join(nxWorkspace, "apps/store/package.json"),
    });
  });

  test("keeps libraries in discovery without making them applications", async () => {
    const root = await mkdtemp(join(tmpdir(), "ngrv-nx-discovery-"));
    const appDir = join(root, "apps/app");
    const libDir = join(root, "libs/routes");
    const nxJson = join(root, "nx.json");
    const appConfig = join(appDir, "project.json");
    const libConfig = join(libDir, "project.json");

    await mkdir(appDir, { recursive: true });
    await mkdir(libDir, { recursive: true });
    await writeFile(nxJson, "{}\n");
    await writeFile(
      appConfig,
      JSON.stringify({
        name: "app",
        projectType: "application",
        root: "apps/app",
      }),
    );
    await writeFile(
      libConfig,
      JSON.stringify({
        name: "routes",
        projectType: "library",
        root: "libs/routes",
        sourceRoot: "libs/routes/source",
      }),
    );

    try {
      const workspace = await discoverWorkspace(join(appDir, "src"));

      expect([...workspace.projects.keys()].sort()).toEqual(["app", "routes"]);
      expect(workspace.projects.get("app")).toMatchObject({
        projectType: "application",
        root: appDir,
        sourceRoot: join(appDir, "src"),
      });
      const routes = workspace.projects.get("routes");
      expect(routes).toMatchObject({
        projectType: "library",
        root: libDir,
        sourceRoot: join(libDir, "source"),
      });
      expect(portableRelative(workspace.workspaceRoot, routes!.sourceRoot)).toBe(
        "libs/routes/source",
      );
      const project = await resolveAngularProject(root);
      expect(project.projectName).toBe("app");
      await expectSelectionError(root, "routes", ["app"]);
    } finally {
      await unlink(appConfig);
      await unlink(libConfig);
      await unlink(nxJson);
      await rmdir(appDir);
      await rmdir(join(root, "apps"));
      await rmdir(libDir);
      await rmdir(join(root, "libs"));
      await rmdir(root);
    }
  });
});

describe("Nx application selection", () => {
  test("selects admin explicitly", async () => {
    const project = await resolveAngularProject(nxWorkspace, "admin");

    expect(project.projectName).toBe("admin");
    expect(project.workspaceRoot).toBe(nxWorkspace);
    expect(project.projectRoot).toBe(join(nxWorkspace, "apps/admin"));
    expect(project.sourceRoot).toBe(join(nxWorkspace, "apps/admin/src"));
    expect(project.tsconfigPath).toBe(
      join(nxWorkspace, "apps/admin/tsconfig.app.json"),
    );
    expect(project.workspaceProjects.map(({ name }) => name).sort()).toEqual([
      "admin",
      "store",
    ]);
  });

  test("selects the application containing the target path", async () => {
    const project = await resolveAngularProject(
      join(nxWorkspace, "apps/admin/src/app/routes"),
    );

    expect(project.projectName).toBe("admin");
    expect(portableRelative(project.workspaceRoot, project.sourceRoot)).toBe(
      "apps/admin/src",
    );
  });

  test("uses the conventional app tsconfig when Nx targets are inferred", async () => {
    const project = await resolveAngularProject(nxWorkspace, "store");

    expect(project.projectName).toBe("store");
    expect(project.tsconfigPath).toBe(
      join(nxWorkspace, "apps/store/tsconfig.app.json"),
    );
  });

  test("rejects an unknown project and lists valid applications", async () => {
    await expectSelectionError(nxWorkspace, "missing");
  });

  test("rejects an ambiguous workspace instead of choosing the first app", async () => {
    await expectSelectionError(nxWorkspace);
  });
});

describe("effective TypeScript configuration", () => {
  test("inherits workspace aliases from tsconfig.base.json", async () => {
    const project = await resolveAngularProject(nxWorkspace, "admin");

    expect(project.tsconfigPaths.baseUrl).toBe(nxWorkspace);
    expect(project.tsconfigPaths.paths).toEqual({
      "@fixture/shared/*": [join(nxWorkspace, "libs/shared/src/*")],
      "@fixture/ui": [join(nxWorkspace, "libs/ui/src/index.ts")],
    });
  });

  test("replaces the inherited paths map when the child declares paths", async () => {
    const project = await resolveAngularProject(nxWorkspace, "store");

    expect(project.tsconfigPaths.baseUrl).toBe(nxWorkspace);
    expect(project.tsconfigPaths.paths).toEqual({
      "@fixture/store/*": [join(nxWorkspace, "apps/store/client/*")],
    });
  });
});

describe("Angular CLI regression", () => {
  test("preserves the legacy project and source-root contract", async () => {
    const project = await resolveAngularProject(angularWorkspace);

    expect(project.projectName).toBe("legacy-app");
    expect(project.workspaceRoot).toBe(angularWorkspace);
    expect(project.projectRoot).toBe(
      join(angularWorkspace, "projects/legacy-app"),
    );
    expect(project.sourceRoot).toBe(
      join(angularWorkspace, "projects/legacy-app/src"),
    );
    expect(project.tsconfigPath).toBe(
      join(angularWorkspace, "projects/legacy-app/tsconfig.app.json"),
    );
    expect(project.tsconfigPaths.paths).toEqual({
      "@legacy/*": [join(angularWorkspace, "projects/legacy-lib/src/*")],
    });
  });
});
