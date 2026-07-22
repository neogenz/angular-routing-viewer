import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRouteEntry } from "../../src/analyzer/route-finder.js";
import { resolveAngularProject } from "../../src/analyzer/project-resolver.js";
import type { AngularProjectInfo } from "../../src/analyzer/types.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const nxWorkspace = join(fixturesRoot, "nx-workspace");

function withFixtureSourceRoot(
  info: AngularProjectInfo,
  fixtureApplication: string,
): AngularProjectInfo {
  return {
    ...info,
    sourceRoot: join(nxWorkspace, `apps/${fixtureApplication}/src`),
  };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected the operation to fail");
}

describe("conventional route entries", () => {
  test("keeps standalone app.routes.ts ahead of app.config.ts", async () => {
    const info = await resolveAngularProject(nxWorkspace, "admin");

    expect(await findRouteEntry(info)).toBe(
      join(nxWorkspace, "apps/admin/src/app/app.routes.ts"),
    );
  });

  test("finds the selected Nx application's own conventional entry", async () => {
    const info = await resolveAngularProject(nxWorkspace, "store");

    expect(await findRouteEntry(info)).toBe(
      join(nxWorkspace, "apps/store/client/app/app.routes.ts"),
    );
  });

  test("keeps app-routing.module.ts ahead of a dynamic provider config", async () => {
    const admin = await resolveAngularProject(nxWorkspace, "admin");
    const info = withFixtureSourceRoot(admin, "ngmodule");

    expect(await findRouteEntry(info)).toBe(
      join(nxWorkspace, "apps/ngmodule/src/app/app-routing.module.ts"),
    );
  });
});

describe("provider-based route entries", () => {
  test("follows a locally aliased identifier through a tsconfig alias and barrel", async () => {
    const admin = await resolveAngularProject(nxWorkspace, "admin");
    const info = withFixtureSourceRoot(admin, "provider");

    expect(await findRouteEntry(info)).toBe(
      join(nxWorkspace, "apps/provider/src/routes/root.routes.ts"),
    );
  });

  test("rejects a dynamic provideRouter argument with its source location", async () => {
    const admin = await resolveAngularProject(nxWorkspace, "admin");
    const info = withFixtureSourceRoot(admin, "dynamic-provider");
    const configFile = join(info.sourceRoot, "app/app.config.ts");

    const error = await captureError(findRouteEntry(info));

    expect(error.message).toContain("provideRouter");
    expect(error.message).toContain(configFile);
  });

  test("reports an unresolved provider import instead of returning app.config.ts", async () => {
    const admin = await resolveAngularProject(nxWorkspace, "admin");
    const info = withFixtureSourceRoot(admin, "unresolved-provider");
    const configFile = join(info.sourceRoot, "app/app.config.ts");

    const error = await captureError(findRouteEntry(info));

    expect(error.message).toContain("@acme/missing-routes");
    expect(error.message).toContain(configFile);
  });
});
